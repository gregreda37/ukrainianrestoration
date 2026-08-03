import os
import stripe
from flask import Blueprint, request, jsonify
from firebase_admin import firestore as admin_firestore
from firebase_admin import auth as admin_auth

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

    # Primary path — org client invoices
    inv_ref = (db.collection("organization_data")
                 .document(org_id)
                 .collection("clients")
                 .document(client_doc_id)
                 .collection("invoices")
                 .document(invoice_id))
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

        # users/{clientUid}/invoices secondary path
        client_uid = summary_snap.to_dict().get("clientUid")
        if client_uid:
            user_inv = (db.collection("users")
                          .document(client_uid)
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
