import os
import time
from flask import Blueprint, request, jsonify
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from firebase_admin import auth as admin_auth

sms_app = Blueprint("sms", __name__)

# Error codes that mean the toll-free number isn't verified
_TF_ERRORS = {
    30032: "Toll-free number not verified. Complete verification at console.twilio.com → Phone Numbers → Manage → Toll-Free Verification.",
    30034: "Toll-free number pending verification. Approval may take 1-3 business days.",
}

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

def _normalise_phone(raw):
    """Return E.164 string or raise ValueError."""
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    if not digits.startswith("1") or len(digits) != 11:
        raise ValueError(f"Cannot normalise phone number: {raw}")
    return "+" + digits

def _send_sms(to_phone, message):
    """Send message and poll once for instant carrier rejections. Returns (sid, status)."""
    client = _twilio_client()
    msg = client.messages.create(body=message, from_=_from_number(), to=to_phone)
    time.sleep(2)
    msg = client.messages(msg.sid).fetch()
    if msg.status in ("failed", "undelivered"):
        code = msg.error_code
        hint = _TF_ERRORS.get(code, f"Message undelivered (error {code}).")
        raise TwilioRestException(status=400, uri="", msg=hint, code=code)
    return msg.sid, msg.status


@sms_app.route("/notify-client", methods=["POST"])
def notify_client():
    if not _require_auth():
        return jsonify({"error": "Unauthorized"}), 401

    data       = request.json or {}
    to_phone   = (data.get("phone") or "").strip()
    notif_type = (data.get("type") or "").strip()
    review_url = (data.get("googleReviewUrl") or "").strip()

    if not to_phone:
        return jsonify({"error": "Missing phone"}), 400

    # Build message — review_request gets the link appended when available
    if notif_type == "review_request":
        if review_url:
            message = f"Ukrainian Restoration: We'd love your feedback! Please leave us a Google review: {review_url}"
        else:
            message = _NOTIFICATION_MESSAGES["review_request"]
    else:
        message = _NOTIFICATION_MESSAGES.get(notif_type) or data.get("message", "").strip()

    if not message:
        return jsonify({"error": "Unknown notification type"}), 400

    try:
        e164 = _normalise_phone(to_phone)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        sid, status = _send_sms(e164, message)
        return jsonify({"sid": sid, "status": status})
    except TwilioRestException as e:
        return jsonify({"error": str(e), "code": e.code}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
