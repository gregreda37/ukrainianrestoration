"""
OpenSign integration backend.

Setup:
1. Sign up at app.opensignlabs.com
2. Go to Settings → API Access and copy:
   - App ID        → OPENSIGN_APP_ID
   - REST API Key  → OPENSIGN_REST_KEY
   - Server URL    → OPENSIGN_SERVER_URL (e.g. https://parseapi.back4app.com)
3. Add these to backend/.env
4. Point an OpenSign webhook to POST /opensign/webhook
"""

import os
import requests as http_requests
from flask import Blueprint, request, jsonify
from firebase_admin import firestore as admin_firestore
from dotenv import load_dotenv

load_dotenv()

opensign_app = Blueprint("opensign", __name__, url_prefix="/opensign")

OPENSIGN_APP_ID    = os.getenv("OPENSIGN_APP_ID", "")
OPENSIGN_REST_KEY  = os.getenv("OPENSIGN_REST_KEY", "")
OPENSIGN_SERVER_URL = os.getenv("OPENSIGN_SERVER_URL", "https://parseapi.back4app.com")


def _parse_headers():
    return {
        "X-Parse-Application-Id": OPENSIGN_APP_ID,
        "X-Parse-REST-API-Key":   OPENSIGN_REST_KEY,
        "Content-Type":           "application/json",
    }


@opensign_app.route("/send", methods=["POST"])
def send_for_signing():
    """
    Creates an OpenSign signing request for a document.
    Returns { signingUrl, requestId } — the frontend stores these
    in the Firestore todo so the client can sign from their portal.
    """
    data = request.json or {}
    doc_url      = data.get("docUrl", "").strip()
    doc_name     = data.get("docName", "Document").strip()
    signer_name  = data.get("signerName", "").strip()
    signer_email = data.get("signerEmail", "").strip()

    if not doc_url or not signer_email:
        return jsonify({"error": "docUrl and signerEmail are required"}), 400

    if not OPENSIGN_APP_ID or not OPENSIGN_REST_KEY:
        return jsonify({"error": "OpenSign credentials not configured in .env"}), 500

    payload = {
        "title": doc_name,
        "note":  "Please review and sign this document.",
        "url":   doc_url,
        "signers": [
            {
                "name":  signer_name or signer_email.split("@")[0],
                "email": signer_email,
                "role":  "signer",
            }
        ],
        "placeholders": [],
        "sendEmail": True,
    }

    try:
        resp = http_requests.post(
            f"{OPENSIGN_SERVER_URL}/1/functions/createcontract",
            headers=_parse_headers(),
            json=payload,
            timeout=15,
        )
        body = resp.json()
        if not resp.ok:
            return jsonify({"error": body.get("error") or f"OpenSign returned {resp.status_code}"}), 502

        result      = body.get("result") or body
        request_id  = result.get("objectId") or result.get("requestId") or ""
        signing_url = result.get("signingUrl") or ""

        # If OpenSign doesn't return a direct signingUrl, construct it
        if not signing_url and request_id:
            signing_url = f"https://app.opensignlabs.com/sign/{request_id}"

        return jsonify({
            "signingUrl": signing_url,
            "requestId":  request_id,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@opensign_app.route("/webhook", methods=["POST"])
def webhook():
    """
    Called by OpenSign when a document is signed.
    Marks the linked client todo as complete and stores the signed doc URL.
    """
    data = request.json or {}

    # OpenSign sends different payloads depending on version.
    # Common fields: objectId / requestId, signedDocumentUrl, status
    request_id      = data.get("objectId") or data.get("requestId") or ""
    signed_doc_url  = data.get("signedDocumentUrl") or data.get("signedUrl") or ""
    status          = (data.get("status") or "").lower()

    # Only act on completed/signed events
    if status not in ("completed", "signed", "document_signed", ""):
        return jsonify({"ok": True})

    if not request_id:
        return jsonify({"ok": True})

    try:
        db = admin_firestore.client()

        # Find todos with matching opensignRequestId using a collection group query.
        # Requires a Firestore composite index on: collectionGroup=todos, opensignRequestId ASC.
        # Create it at: Firebase Console → Firestore → Indexes → Add → Collection group: todos
        todos_query = db.collection_group("todos").where(
            "opensignRequestId", "==", request_id
        ).limit(5).stream()

        for todo_doc in todos_query:
            update = {"completed": True}
            if signed_doc_url:
                update["signedDocumentUrl"] = signed_doc_url
            todo_doc.reference.update(update)

    except Exception as e:
        # Log but don't fail — webhook should always return 200
        print(f"[OpenSign webhook] Error updating todo: {e}")

    return jsonify({"ok": True})
