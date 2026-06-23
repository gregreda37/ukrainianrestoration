import os
import time
from flask import Blueprint, request, jsonify
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

sms_app = Blueprint("sms", __name__)

# Error codes that mean the toll-free number isn't verified
_TF_ERRORS = {
    30032: "Toll-free number not verified. Complete verification at console.twilio.com → Phone Numbers → Manage → Toll-Free Verification.",
    30034: "Toll-free number pending verification. Approval may take 1-3 business days.",
}

def _twilio_client():
    sid   = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not sid or not token:
        raise RuntimeError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env")
    return Client(sid, token)

def _from_number():
    num = os.environ.get("TWILIO_FROM_NUMBER", "").strip()
    if not num:
        raise RuntimeError("TWILIO_FROM_NUMBER must be set in .env")
    return num

_NOTIFICATION_MESSAGES = {
    "portal_ready":    "Ukrainian Restoration: Your client portal is ready! Sign in to track your project: ukrainianrestoration.com/myclaim/login",
    "new_todo":        "Ukrainian Restoration: You have new tasks waiting in your portal. Please log in to review: ukrainianrestoration.com/myclaim/login",
    "progress_update": "Ukrainian Restoration: There's a new update on your restoration project. Log in to your portal for details: ukrainianrestoration.com/myclaim/login",
    "review_request":  "Ukrainian Restoration: We'd love your feedback! If you're happy with our work, please leave us a Google review. Thank you for choosing us!",
}

@sms_app.route("/notify-client", methods=["POST"])
def notify_client():
    data     = request.json or {}
    to_phone = (data.get("phone") or "").strip()
    notif_type = (data.get("type") or "").strip()
    message  = _NOTIFICATION_MESSAGES.get(notif_type) or data.get("message", "").strip()

    if not to_phone:
        return jsonify({"error": "Missing phone"}), 400
    if not message:
        return jsonify({"error": "Unknown notification type"}), 400

    digits = "".join(c for c in to_phone if c.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    if not digits.startswith("1") or len(digits) != 11:
        return jsonify({"error": f"Cannot normalise phone number: {to_phone}"}), 400
    e164 = "+" + digits

    try:
        client = _twilio_client()
        msg = client.messages.create(body=message, from_=_from_number(), to=e164)
        time.sleep(2)
        msg = client.messages(msg.sid).fetch()
        if msg.status in ("failed", "undelivered"):
            code = msg.error_code
            hint = _TF_ERRORS.get(code, f"Message undelivered (error {code}).")
            return jsonify({"error": hint, "code": code}), 400
        return jsonify({"sid": msg.sid, "status": msg.status})
    except TwilioRestException as e:
        return jsonify({"error": str(e), "code": e.code}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@sms_app.route("/sms/notify", methods=["POST"])
def notify():
    data     = request.json or {}
    to_phone = (data.get("phone") or "").strip()
    message  = (data.get("message") or "").strip()

    if not to_phone:
        return jsonify({"error": "Missing phone"}), 400
    if not message:
        return jsonify({"error": "Missing message"}), 400

    # Normalise to E.164 — strip non-digits, add +1 if 10 digits
    digits = "".join(c for c in to_phone if c.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    if not digits.startswith("1") or len(digits) != 11:
        return jsonify({"error": f"Cannot normalise phone number: {to_phone}"}), 400
    e164 = "+" + digits

    try:
        client = _twilio_client()
        msg = client.messages.create(
            body=message,
            from_=_from_number(),
            to=e164,
        )

        # Poll once after a short delay — catches instant carrier rejections
        # (e.g. 30032 toll-free unverified, 30006 landline unreachable)
        time.sleep(2)
        msg = client.messages(msg.sid).fetch()

        if msg.status in ("failed", "undelivered"):
            code = msg.error_code
            hint = _TF_ERRORS.get(code, f"Message undelivered (error {code}).")
            return jsonify({"error": hint, "code": code}), 400

        return jsonify({"sid": msg.sid, "status": msg.status})

    except TwilioRestException as e:
        return jsonify({"error": str(e), "code": e.code}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
