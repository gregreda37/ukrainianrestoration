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
WIRE_TRANSFER_FEE = 5.00   # Flat Stripe fee for US domestic wire transfers


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
    intent        = intent.to_dict() if hasattr(intent, "to_dict") else intent
    meta          = intent.get("metadata", {})
    org_id        = meta.get("orgId")
    client_doc_id = meta.get("clientDocId")
    invoice_id    = meta.get("invoiceId")
    invoice_total = float(meta.get("invoiceTotal", 0))
    fee           = float(meta.get("fee", 0))
    client_uid    = meta.get("clientUid") or None
    payment_type  = meta.get("paymentType", "full")
    amount_recv   = intent.get("amount_received", 0) / 100

    if not all([org_id, client_doc_id, invoice_id]):
        return

    db  = admin_firestore.client()
    fst = admin_firestore.SERVER_TIMESTAMP
    paid_date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    payment_method_type = meta.get("paymentMethod", "credit_card")
    is_wire = payment_method_type == "wire_transfer"

    if payment_type == "deposit":
        update = {
            "depositPaid":           True,
            "depositPaidAmount":     invoice_total,
            "depositPaidAt":         fst,
            "stripeStatus":          "deposit_paid",
            "stripePaymentIntentId": intent.get("id"),
        }
    else:
        if is_wire:
            notes = (
                f"Paid via wire transfer | "
                f"Wire fee: ${fee:.2f} | "
                f"Total wired: ${amount_recv:.2f}"
            )
        else:
            notes = (
                f"Paid via Stripe | "
                f"Processing fee: ${fee:.2f} | "
                f"Total charged: ${amount_recv:.2f}"
            )
        update = {
            "status":               "paid",
            "stripeStatus":         "succeeded",
            "stripePaymentIntentId": intent.get("id"),
            "paidAt":               fst,
            "paidDate":             paid_date_str,
            "paidAmount":           invoice_total,
            "paymentMethod":        payment_method_type,
            "paymentNotes":         notes,
        }

    # Resolve correct primary path (users/ or org/)
    inv_ref, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)
    inv_ref.set(update, merge=True)

    if payment_type != "deposit":
        # Auto-complete the pay_invoice todo if one was linked to this invoice
        inv_data          = inv_snap.to_dict() if inv_snap.exists else {}
        payment_link_todo = inv_data.get("paymentLinkTodoId")
        if payment_link_todo:
            (db.collection("organization_data")
               .document(org_id)
               .collection("clients")
               .document(client_doc_id)
               .collection("todos")
               .document(payment_link_todo)
               .set({"completed": True, "completedAt": fst}, merge=True))

    # invoice_summary mirror
    summary_ref  = (db.collection("organization_data")
                      .document(org_id)
                      .collection("invoice_summary")
                      .document(invoice_id))
    summary_snap = summary_ref.get()
    if summary_snap.exists:
        if payment_type == "deposit":
            summary_ref.set({
                "depositPaid":       True,
                "depositPaidAmount": invoice_total,
                "stripeStatus":      "deposit_paid",
            }, merge=True)
        else:
            summary_ref.set({
                "status":       "paid",
                "paidAmount":   invoice_total,
                "stripeStatus": "succeeded",
                "paidDate":     paid_date_str,
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

    # SMS receipt — best-effort, never fails the webhook
    try:
        inv_data       = inv_snap.to_dict() if inv_snap.exists else {}
        raw_phone      = inv_data.get("clientPhone") or ""
        company_name   = inv_data.get("companyName") or ""
        invoice_number = inv_data.get("invoiceNumber") or invoice_id
        full_total     = float(inv_data.get("total") or 0)

        def _fmt(n):
            return "${:,.2f}".format(n)

        if raw_phone:
            e164 = _normalise_phone(raw_phone)
            if payment_type == "deposit":
                remaining = max(0.0, full_total - invoice_total)
                body = (
                    f"✓ Deposit received — Invoice #{invoice_number}\n"
                    f"Deposit: {_fmt(invoice_total)}\n"
                    f"Remaining balance: {_fmt(remaining)}\n"
                    f"— {company_name}"
                )
            else:
                body = (
                    f"✓ Payment received — Invoice #{invoice_number}\n"
                    f"Amount paid: {_fmt(invoice_total)}\n"
                    f"Thank you! — {company_name}"
                )
            _send_sms(e164, body)
    except Exception:
        pass


def _on_payment_failed(intent):
    intent        = intent.to_dict() if hasattr(intent, "to_dict") else intent
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
    invoice_num  = inv.get("invoiceNumber", "your invoice")
    company      = inv.get("companyName", "Ukrainian Restoration")
    total        = float(inv.get("total") or 0)
    deposit_amt  = float(inv.get("depositAmount") or 0)
    deposit_paid = bool(inv.get("depositPaid"))

    def _fmt(n: float) -> str:
        return "${:,.2f}".format(n)

    if deposit_amt > 0 and not deposit_paid:
        amount_label = f"deposit due: {_fmt(deposit_amt)}"
    elif deposit_amt > 0 and deposit_paid:
        paid_amt     = float(inv.get("depositPaidAmount") or deposit_amt)
        remaining    = max(0.0, total - paid_amt)
        amount_label = f"remaining balance: {_fmt(remaining)}"
    else:
        amount_label = f"total: {_fmt(total)}"

    message = (
        f"{company}: Invoice {invoice_num} ({amount_label}) is ready. "
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
        "invoiceNumber":     inv.get("invoiceNumber"),
        "clientName":        inv.get("clientName"),
        "companyName":       inv.get("companyName"),
        "companyPhone":      inv.get("companyPhone"),
        "issueDate":         inv.get("issueDate"),
        "dueDate":           inv.get("dueDate"),
        "lineItems":         inv.get("lineItems", []),
        "subtotal":          inv.get("subtotal"),
        "taxAmount":         inv.get("taxAmount"),
        "discount":          inv.get("discount"),
        "total":             invoice_total,
        "fee":               fee,
        "totalCharged":      round(invoice_total + fee, 2),
        "notes":             inv.get("notes"),
        "status":            inv.get("status"),
        "depositAmount":     float(inv.get("depositAmount") or 0) or None,
        "depositPaid":       inv.get("depositPaid", False),
        "depositPaidAmount": float(inv.get("depositPaidAmount") or 0),
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
        try:
            exp_dt = exp if isinstance(exp, datetime) else exp.ToDatetime(tzinfo=timezone.utc)
            if exp_dt < now_utc:
                return jsonify({"error": "Payment link has expired"}), 410
        except Exception:
            pass  # malformed expiry — allow through rather than 500

    org_id        = link.get("orgId",       "").strip()
    client_doc_id = link.get("clientDocId", "").strip()
    invoice_id    = link.get("invoiceId",   "").strip()
    client_uid    = link.get("clientUid")

    if not all([org_id, client_doc_id, invoice_id]):
        return jsonify({"error": "Payment link is missing required fields"}), 400

    inv_ref, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()
    if inv.get("status") in ("paid", "cancelled"):
        return jsonify({"error": "Invoice already paid or cancelled"}), 400

    payment_type = (data.get("paymentType") or "full").strip()
    inv_total    = float(inv.get("total", 0))

    if payment_type == "deposit":
        if inv.get("depositPaid"):
            return jsonify({"error": "Deposit has already been paid for this invoice"}), 400
        deposit_amt = float(inv.get("depositAmount") or 0)
        if deposit_amt <= 0:
            return jsonify({"error": "No deposit amount configured for this invoice"}), 400
        invoice_total = deposit_amt
    elif payment_type == "balance":
        deposit_paid_amt = float(inv.get("depositPaidAmount") or 0)
        invoice_total    = round(inv_total - deposit_paid_amt, 2)
        if invoice_total <= 0:
            return jsonify({"error": "Remaining balance is zero"}), 400
    else:
        invoice_total = inv_total

    fee           = _calc_fee(invoice_total)
    total_charged = round(invoice_total + fee, 2)

    try:
        s = _stripe()
        existing_pi = inv.get("stripePaymentIntentId")
        if existing_pi:
            try:
                pi = s.PaymentIntent.retrieve(existing_pi)
                apm_obj = getattr(pi, "automatic_payment_methods", None)
                apm = bool(apm_obj and getattr(apm_obj, "enabled", False))
                pi_dict       = pi.to_dict() if hasattr(pi, "to_dict") else {}
                existing_type = (pi_dict.get("metadata") or {}).get("paymentType", "full")
                if apm and existing_type == payment_type and pi.status in ("requires_payment_method", "requires_confirmation", "requires_action"):
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
            "paymentType":      payment_type,
        }
        if client_uid:
            pi_metadata["clientUid"] = client_uid

        intent = s.PaymentIntent.create(
            amount=_to_cents(total_charged),
            currency="usd",
            automatic_payment_methods={"enabled": True},
            description=(
                f"Invoice {inv.get('invoiceNumber', invoice_id)}"
                f" — {inv.get('clientName', '')}"
            ),
            metadata=pi_metadata,
        )

        inv_ref.set(
            {"stripePaymentIntentId": intent.id, "stripeStatus": "pending"},
            merge=True,
        )
    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    return jsonify({
        "clientSecret": intent.client_secret,
        "fee":          fee,
        "invoiceTotal": invoice_total,
        "totalCharged": total_charged,
    })


# ── Wire Transfer (bank transfer via customer balance) ────────────────────────

@stripe_app.route("/stripe/create-wire-intent-public", methods=["POST"])
def create_wire_intent_public():
    """Public — creates a bank-transfer PaymentIntent. Returns virtual account details."""
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
        try:
            exp_dt = exp if isinstance(exp, datetime) else exp.ToDatetime(tzinfo=timezone.utc)
            if exp_dt < now_utc:
                return jsonify({"error": "Payment link has expired"}), 410
        except Exception:
            pass

    org_id        = link.get("orgId",       "").strip()
    client_doc_id = link.get("clientDocId", "").strip()
    invoice_id    = link.get("invoiceId",   "").strip()
    client_uid    = link.get("clientUid")

    if not all([org_id, client_doc_id, invoice_id]):
        return jsonify({"error": "Payment link is missing required fields"}), 400

    inv_ref, inv_snap = _resolve_inv(db, org_id, client_doc_id, invoice_id, client_uid)

    if not inv_snap.exists:
        return jsonify({"error": "Invoice not found"}), 404

    inv = inv_snap.to_dict()
    if inv.get("status") in ("paid", "cancelled"):
        return jsonify({"error": "Invoice already paid or cancelled"}), 400

    invoice_total = float(inv.get("total", 0))
    if invoice_total <= 0:
        return jsonify({"error": "Invoice total must be greater than zero"}), 400

    wire_fee      = WIRE_TRANSFER_FEE
    total_charged = round(invoice_total + wire_fee, 2)

    try:
        s = _stripe()

        # Stripe requires a Customer object for bank transfers — create or reuse.
        existing_customer_id = inv.get("stripeCustomerId", "").strip() if inv.get("stripeCustomerId") else ""
        customer = None
        if existing_customer_id:
            try:
                customer = s.Customer.retrieve(existing_customer_id)
            except stripe.error.StripeError:
                customer = None

        if not customer:
            customer_params = {
                "name": inv.get("clientName") or "",
                "metadata": {
                    "orgId":        org_id,
                    "clientDocId":  client_doc_id,
                    "invoiceId":    invoice_id,
                },
            }
            email = (inv.get("clientEmail") or "").strip()
            phone = (inv.get("clientPhone") or "").strip()
            if email: customer_params["email"] = email
            if phone: customer_params["phone"] = phone
            customer = s.Customer.create(**customer_params)
            inv_ref.set({"stripeCustomerId": customer.id}, merge=True)

        pi_metadata = {
            "orgId":            org_id,
            "clientDocId":      client_doc_id,
            "invoiceId":        invoice_id,
            "invoiceTotal":     str(invoice_total),
            "fee":              str(wire_fee),
            "paymentLinkToken": token,
            "paymentType":      "full",
            "paymentMethod":    "wire_transfer",
        }
        if client_uid:
            pi_metadata["clientUid"] = client_uid

        intent = s.PaymentIntent.create(
            amount=_to_cents(total_charged),
            currency="usd",
            customer=customer.id,
            payment_method_types=["customer_balance"],
            payment_method_data={"type": "customer_balance"},
            payment_method_options={
                "customer_balance": {
                    "funding_type": "bank_transfer",
                    "bank_transfer": {"type": "us_bank_transfer"},
                }
            },
            confirm=True,
            description=(
                f"Invoice {inv.get('invoiceNumber', invoice_id)}"
                f" — {inv.get('clientName', '')}"
            ),
            metadata=pi_metadata,
        )

        inv_ref.set(
            {"stripePaymentIntentId": intent.id, "stripeStatus": "wire_pending"},
            merge=True,
        )

        # Extract virtual bank account details from next_action
        intent_data  = intent.to_dict() if hasattr(intent, "to_dict") else intent
        next_action  = intent_data.get("next_action") or {}
        instructions = next_action.get("display_bank_transfer_instructions") or {}
        fin_addrs    = instructions.get("financial_addresses") or []
        reference    = instructions.get("reference", "")
        hosted_url   = instructions.get("hosted_instructions_url", "")

        bank_info = {}
        for fa in fin_addrs:
            if fa.get("type") == "aba":
                aba = fa.get("aba") or {}
                bank_info = {
                    "routingNumber": aba.get("routing_number", ""),
                    "accountNumber": aba.get("account_number", ""),
                    "bankName":      aba.get("bank_name", "Stripe / Evolve Bank & Trust"),
                    "accountType":   "Checking",
                }
                break

    except stripe.error.StripeError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": f"Unexpected error: {e}"}), 500

    return jsonify({
        "invoiceTotal":    invoice_total,
        "wireFee":         wire_fee,
        "totalCharged":    total_charged,
        "reference":       reference,
        "hostedUrl":       hosted_url,
        "bankInfo":        bank_info,
        "paymentIntentId": intent.id,
    })
