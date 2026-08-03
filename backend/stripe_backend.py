import os
import uuid
import stripe
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify
from firebase_admin import firestore as admin_firestore
from firebase_admin import auth as admin_auth
from sms_backend import _normalise_phone, _send_sms

stripe_app = Blueprint("stripe_payments", __name__)

STRIPE_FEE_RATE  = 0.029   # 2.9%
STRIPE_FEE_FIXED = 0.30    # $0.30


def _stripe():
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured.")
    stripe.api_key = key
    return stripe


def _require_auth():
    raw = (
        request.headers.get("X-Firebase-ID-Token", "")
        or request.headers.get("Authorization", "")
    )
    token = raw[7:] if raw.startswith("Bearer ") else raw
    if not token:
        return None
    try:
        return admin_auth.verify_id_token(token)
    except Exception:
        return None


def _calc_fee(invoice_total: float) -> float:
    """Convenience fee passed to the client: 2.9% + $0.30."""
    return round(invoice_total * STRIPE_FEE_RATE + STRIPE_FEE_FIXED, 2)


def _to_cents(amount: float) -> int:
    return round(amount * 100)


# ── Create Payment Intent ────────────────────────────────────────────────────

@stripe_app.route("/stripe/create-payment-intent", methods=["POST"])
def create_payment_intent():
    if not _require_auth():
        return jsonify({"error": "Unauthorized"}), 401

    data          = request.json or {}
    org_id        = (data.get("orgId")       or "").strip()
    client_doc_id = (data.get("clientDocId") or "").strip()
    invoice_id    = (data.get("invoiceId")   or "").strip()

    if not all([org_id, client_doc_id, invoice_id]):
        return jsonify({"error": "Missing orgId, clientDocId, or invoiceId"}), 400

    db = admin_firestore.client()
    inv_ref  = (db.collection("organization_data")
                  .document(org_id)
                  .collection("clients")
                  .document(client_doc_id)
                  .collection("invoices")
                  .document(invoice_id))
    inv_snap = inv_ref.get()

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()
    if inv.get("status") in ("paid", "cancelled"):
        return jsonify({"error": "Invoice is already paid or cancelled"}), 400

    invoice_total = float(inv.get("total", 0))
    if invoice_total <= 0:
        return jsonify({"error": "Invoice total must be greater than zero"}), 400

    fee           = _calc_fee(invoice_total)
    total_charged = round(invoice_total + fee, 2)

    try:
        s = _stripe()
        # Reuse an existing pending PaymentIntent when possible
        existing_pi_id = inv.get("stripePaymentIntentId")
        if existing_pi_id:
            try:
                existing = s.PaymentIntent.retrieve(existing_pi_id)
                if existing.status in ("requires_payment_method", "requires_confirmation", "requires_action"):
                    inv_ref.set({"stripeStatus": "pending"}, merge=True)
                    return jsonify({
                        "clientSecret":  existing.client_secret,
                        "fee":           fee,
                        "invoiceTotal":  invoice_total,
                        "totalCharged":  total_charged,
                        "paymentIntentId": existing.id,
                    })
            except stripe.error.StripeError:
                pass  # fall through to create a new one

        intent = s.PaymentIntent.create(
            amount=_to_cents(total_charged),
            currency="usd",
            description=(
                f"Invoice {inv.get('invoiceNumber', invoice_id)}"
                f" — {inv.get('clientName', '')}"
            ),
            metadata={
                "orgId":        org_id,
                "clientDocId":  client_doc_id,
                "invoiceId":    invoice_id,
                "invoiceTotal": str(invoice_total),
                "fee":          str(fee),
            },
        )
    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    inv_ref.set(
        {"stripePaymentIntentId": intent.id, "stripeStatus": "pending"},
        merge=True,
    )

    return jsonify({
        "clientSecret":  intent.client_secret,
        "fee":           fee,
        "invoiceTotal":  invoice_total,
        "totalCharged":  total_charged,
        "paymentIntentId": intent.id,
    })


# ── Webhook ──────────────────────────────────────────────────────────────────

@stripe_app.route("/stripe/webhook", methods=["POST"])
def stripe_webhook():
    payload        = request.get_data()
    sig_header     = request.headers.get("Stripe-Signature", "")
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()

    if not webhook_secret:
        return jsonify({"error": "STRIPE_WEBHOOK_SECRET not configured"}), 500

    try:
        s     = _stripe()
        event = s.Webhook.construct_event(payload, sig_header, webhook_secret)
    except stripe.error.SignatureVerificationError:
        return jsonify({"error": "Invalid signature"}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    if event["type"] == "payment_intent.succeeded":
        _on_payment_succeeded(event["data"]["object"])
    elif event["type"] == "payment_intent.payment_failed":
        _on_payment_failed(event["data"]["object"])

    return jsonify({"received": True})


def _on_payment_succeeded(intent):
    meta          = intent.get("metadata", {})
    org_id        = meta.get("orgId")
    client_doc_id = meta.get("clientDocId")
    invoice_id    = meta.get("invoiceId")
    invoice_total = float(meta.get("invoiceTotal", 0))
    fee           = float(meta.get("fee", 0))
    client_uid    = meta.get("clientUid") or None
    amount_recv   = intent.get("amount_received", 0) / 100

    if not all([org_id, client_doc_id, invoice_id]):
        return

    db  = admin_firestore.client()
    fst = admin_firestore.SERVER_TIMESTAMP

    update = {
        "status":               "paid",
        "stripeStatus":         "succeeded",
        "stripePaymentIntentId": intent.get("id"),
        "paidAt":               fst,
        "paidAmount":           invoice_total,
        "paymentMethod":        "credit_card",
        "paymentNotes": (
            f"Paid via Stripe | "
            f"Processing fee: ${fee:.2f} | "
            f"Total charged: ${amount_recv:.2f}"
        ),
    }

    # Resolve correct primary path (users/ or org/)
    inv_ref, _ = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)
    inv_ref.set(update, merge=True)

    # invoice_summary mirror
    summary_ref  = (db.collection("organization_data")
                      .document(org_id)
                      .collection("invoice_summary")
                      .document(invoice_id))
    summary_snap = summary_ref.get()
    if summary_snap.exists:
        summary_ref.set({
            "status":       "paid",
            "paidAmount":   invoice_total,
            "stripeStatus": "succeeded",
        }, merge=True)

        # Also update users/{clientUid}/invoices if discovered via summary
        summary_uid = summary_snap.to_dict().get("clientUid")
        if summary_uid and summary_uid != client_uid:
            user_inv = (db.collection("users")
                          .document(summary_uid)
                          .collection("invoices")
                          .document(invoice_id))
            if user_inv.get().exists:
                user_inv.set(update, merge=True)


def _on_payment_failed(intent):
    meta          = intent.get("metadata", {})
    org_id        = meta.get("orgId")
    client_doc_id = meta.get("clientDocId")
    invoice_id    = meta.get("invoiceId")

    if not all([org_id, client_doc_id, invoice_id]):
        return

    db = admin_firestore.client()
    (db.collection("organization_data")
       .document(org_id)
       .collection("clients")
       .document(client_doc_id)
       .collection("invoices")
       .document(invoice_id)
       .set({"stripeStatus": "failed"}, merge=True))


# ── Invoice resolver (handles org-path vs users-path) ───────────────────────

def _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid=None):
    """Return (ref, snap) checking users/ path first if client_uid provided."""
    if client_uid:
        ref = (db.collection("users")
                 .document(client_uid)
                 .collection("invoices")
                 .document(invoice_id))
        snap = ref.get()
        if snap.exists:
            return ref, snap
    ref = (db.collection("organization_data")
             .document(org_id)
             .collection("clients")
             .document(client_doc_id)
             .collection("invoices")
             .document(invoice_id))
    return ref, ref.get()


# ── Payment Links (public, shareable) ────────────────────────────────────────

_BASE_URL = "https://ukrainianrestoration.com"


def _payment_url(token: str) -> str:
    return f"{_BASE_URL}/myclaim/pay/{token}"


def _send_payment_sms(inv: dict, payment_url: str, phones: list):
    """Send payment link SMS to one or more phones."""
    invoice_num = inv.get("invoiceNumber", "your invoice")
    company     = inv.get("companyName", "Ukrainian Restoration")
    total       = float(inv.get("total", 0))
    message     = (
        f"{company}: Invoice {invoice_num} for ${total:,.2f} is ready. "
        f"Pay securely online: {payment_url}"
    )
    results = []
    for phone in phones:
        if not phone:
            continue
        try:
            e164 = _normalise_phone(str(phone).strip())
            sid, status = _send_sms(e164, message)
            results.append({"phone": e164, "sid": sid, "status": status})
        except Exception as err:
            results.append({"phone": phone, "error": str(err)})
    return results


@stripe_app.route("/stripe/create-payment-link", methods=["POST"])
def create_payment_link():
    """Generate a shareable payment link. Optionally send it via SMS."""
    if not _require_auth():
        return jsonify({"error": "Unauthorized"}), 401

    data          = request.json or {}
    org_id        = (data.get("orgId")       or "").strip()
    client_doc_id = (data.get("clientDocId") or "").strip()
    invoice_id    = (data.get("invoiceId")   or "").strip()
    client_uid    = (data.get("clientUid")   or "").strip() or None
    phones        = [p for p in (data.get("phones") or []) if p]

    if not all([org_id, client_doc_id, invoice_id]):
        return jsonify({"error": "Missing orgId, clientDocId, or invoiceId"}), 400

    db               = admin_firestore.client()
    inv_ref, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()
    if inv.get("status") in ("paid", "cancelled"):
        return jsonify({"error": "Invoice already paid or cancelled"}), 400

    now_utc    = datetime.now(timezone.utc)
    expires_at = now_utc + timedelta(days=30)

    # Reuse existing valid token when possible
    existing_token = inv.get("paymentLinkToken")
    if existing_token:
        link_snap = db.collection("payment_links").document(existing_token).get()
        if link_snap.exists:
            link_exp = link_snap.to_dict().get("expiresAt")
            if link_exp:
                exp_dt = link_exp if isinstance(link_exp, datetime) else link_exp.ToDatetime(tzinfo=timezone.utc)
                if exp_dt > now_utc:
                    token       = existing_token
                    payment_url = _payment_url(token)
                    sms_results = _send_payment_sms(inv, payment_url, phones) if phones else []
                    return jsonify({"token": token, "paymentUrl": payment_url, "sms": sms_results})

    # Create new token
    token = uuid.uuid4().hex

    link_doc = {
        "orgId":         org_id,
        "clientDocId":   client_doc_id,
        "invoiceId":     invoice_id,
        "clientPhone":   inv.get("clientPhone") or "",
        "clientName":    inv.get("clientName")  or "",
        "invoiceNumber": inv.get("invoiceNumber") or invoice_id,
        "total":         float(inv.get("total", 0)),
        "expiresAt":     expires_at,
        "createdAt":     admin_firestore.SERVER_TIMESTAMP,
    }
    if client_uid:
        link_doc["clientUid"] = client_uid

    db.collection("payment_links").document(token).set(link_doc)

    inv_ref.set({"paymentLinkToken": token, "status": "sent"}, merge=True)

    payment_url = _payment_url(token)
    sms_results = _send_payment_sms(inv, payment_url, phones) if phones else []

    return jsonify({"token": token, "paymentUrl": payment_url, "sms": sms_results})


@stripe_app.route("/stripe/payment-link/<token>", methods=["GET"])
def get_payment_link(token):
    """Public — returns invoice data for the pay page; no auth required."""
    db         = admin_firestore.client()
    link_snap  = db.collection("payment_links").document(token).get()

    if not link_snap.exists:
        return jsonify({"error": "Payment link not found or expired"}), 404

    link    = link_snap.to_dict()
    now_utc = datetime.now(timezone.utc)
    exp     = link.get("expiresAt")
    if exp:
        exp_dt = exp if isinstance(exp, datetime) else exp.ToDatetime(tzinfo=timezone.utc)
        if exp_dt < now_utc:
            return jsonify({"error": "This payment link has expired"}), 410

    org_id        = link["orgId"]
    client_doc_id = link["clientDocId"]
    invoice_id    = link["invoiceId"]
    client_uid    = link.get("clientUid")

    _, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()

    if inv.get("status") == "paid":
        return jsonify({
            "alreadyPaid":   True,
            "invoiceNumber": inv.get("invoiceNumber"),
            "companyName":   inv.get("companyName"),
        })

    invoice_total = float(inv.get("total", 0))
    fee           = _calc_fee(invoice_total)

    return jsonify({
        "invoiceNumber": inv.get("invoiceNumber"),
        "clientName":    inv.get("clientName"),
        "companyName":   inv.get("companyName"),
        "companyPhone":  inv.get("companyPhone"),
        "issueDate":     inv.get("issueDate"),
        "dueDate":       inv.get("dueDate"),
        "lineItems":     inv.get("lineItems", []),
        "subtotal":      inv.get("subtotal"),
        "taxAmount":     inv.get("taxAmount"),
        "discount":      inv.get("discount"),
        "total":         invoice_total,
        "fee":           fee,
        "totalCharged":  round(invoice_total + fee, 2),
        "notes":         inv.get("notes"),
        "status":        inv.get("status"),
    })


@stripe_app.route("/stripe/payment-intent-public", methods=["POST"])
def create_payment_intent_public():
    """Public — creates a PaymentIntent using a payment link token; no auth required."""
    data  = request.json or {}
    token = (data.get("token") or "").strip()

    if not token:
        return jsonify({"error": "Missing token"}), 400

    db        = admin_firestore.client()
    link_snap = db.collection("payment_links").document(token).get()

    if not link_snap.exists:
        return jsonify({"error": "Payment link not found"}), 404

    link    = link_snap.to_dict()
    now_utc = datetime.now(timezone.utc)
    exp     = link.get("expiresAt")
    if exp:
        exp_dt = exp if isinstance(exp, datetime) else exp.ToDatetime(tzinfo=timezone.utc)
        if exp_dt < now_utc:
            return jsonify({"error": "Payment link has expired"}), 410

    org_id        = link["orgId"]
    client_doc_id = link["clientDocId"]
    invoice_id    = link["invoiceId"]
    client_uid    = link.get("clientUid")

    inv_ref, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()
    if inv.get("status") in ("paid", "cancelled"):
        return jsonify({"error": "Invoice already paid or cancelled"}), 400

    invoice_total = float(inv.get("total", 0))
    fee           = _calc_fee(invoice_total)
    total_charged = round(invoice_total + fee, 2)

    try:
        s = _stripe()
        existing_pi = inv.get("stripePaymentIntentId")
        if existing_pi:
            try:
                pi = s.PaymentIntent.retrieve(existing_pi)
                if pi.status in ("requires_payment_method", "requires_confirmation", "requires_action"):
                    return jsonify({
                        "clientSecret": pi.client_secret,
                        "fee":          fee,
                        "invoiceTotal": invoice_total,
                        "totalCharged": total_charged,
                    })
            except stripe.error.StripeError:
                pass

        pi_metadata = {
            "orgId":            org_id,
            "clientDocId":      client_doc_id,
            "invoiceId":        invoice_id,
            "invoiceTotal":     str(invoice_total),
            "fee":              str(fee),
            "paymentLinkToken": token,
        }
        if client_uid:
            pi_metadata["clientUid"] = client_uid

        intent = s.PaymentIntent.create(
            amount=_to_cents(total_charged),
            currency="usd",
            description=(
                f"Invoice {inv.get('invoiceNumber', invoice_id)}"
                f" — {inv.get('clientName', '')}"
            ),
            metadata=pi_metadata,
        )
    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500

    inv_ref.set(
        {"stripePaymentIntentId": intent.id, "stripeStatus": "pending"},
        merge=True,
    )

    return jsonify({
        "clientSecret": intent.client_secret,
        "fee":          fee,
        "invoiceTotal": invoice_total,
        "totalCharged": total_charged,
    })
