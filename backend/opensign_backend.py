"""
OpenSign integration backend.

Setup:
1. Sign up at app.opensignlabs.com
2. Go to Settings → API Access → copy your API Token
3. Add to backend/.env:
      OPENSIGN_API_KEY=<your token>
4. Point an OpenSign webhook to POST /opensign/webhook
"""

import os
import requests as http_requests
from flask import Blueprint, request, jsonify
from firebase_admin import firestore as admin_firestore
from dotenv import load_dotenv

load_dotenv()

opensign_app = Blueprint("opensign", __name__, url_prefix="/opensign")

OPENSIGN_API_KEY = os.getenv("OPENSIGN_API_KEY", "")
OPENSIGN_BASE_URL = os.getenv("OPENSIGN_BASE_URL", "https://app.opensignlabs.com")


def _headers():
    return {
        "Authorization": f"Bearer {OPENSIGN_API_KEY}",
        "Content-Type":  "application/json",
    }


@opensign_app.route("/send", methods=["POST"])
def send_for_signing():
    """
    Creates an OpenSign signing request.
    Returns { signingUrl, requestId } for storage in the Firestore todo.
    """
    data         = request.json or {}
    doc_url      = data.get("docUrl",      "").strip()
    doc_name     = data.get("docName",     "Document").strip()
    signer_name  = data.get("signerName",  "").strip()
    signer_email = data.get("signerEmail", "").strip()

    if not doc_url or not signer_email:
        return jsonify({"error": "docUrl and signerEmail are required"}), 400

    if not OPENSIGN_API_KEY:
        return jsonify({"error": "OPENSIGN_API_KEY not set in backend .env"}), 500

    payload = {
        "title":    doc_name,
        "fileUrl":  doc_url,
        "note":     "Please review and sign this document.",
        "signers": [
            {
                "name":  signer_name or signer_email.split("@")[0],
                "email": signer_email,
            }
        ],
        "sendEmail": True,
    }

    # Try the OpenSign REST v1 endpoint first
    tried = []
    for endpoint in [
        f"{OPENSIGN_BASE_URL}/api/v1/document/send",
        f"{OPENSIGN_BASE_URL}/api/v1/sendDocument",
        f"{OPENSIGN_BASE_URL}/api/v1/documents",
    ]:
        tried.append(endpoint)
        try:
            resp = http_requests.post(endpoint, headers=_headers(), json=payload, timeout=15)
            if resp.status_code == 404:
                continue  # wrong endpoint — try the next one

            body = resp.json() if resp.content else {}
            if not resp.ok:
                err = body.get("error") or body.get("message") or f"HTTP {resp.status_code}"
                return jsonify({"error": err, "endpoint": endpoint}), 502

            # Parse the response — OpenSign may nest under result/data
            result     = body.get("result") or body.get("data") or body
            request_id = (result.get("objectId") or result.get("id")
                          or result.get("requestId") or result.get("documentId") or "")
            signing_url = (result.get("signingUrl") or result.get("signUrl")
                           or result.get("url") or "")

            if not signing_url and request_id:
                signing_url = f"{OPENSIGN_BASE_URL}/sign/{request_id}"

            return jsonify({"signingUrl": signing_url, "requestId": request_id})

        except Exception as e:
            return jsonify({"error": str(e), "endpoint": endpoint}), 500

    return jsonify({
        "error": "Could not find a working OpenSign API endpoint",
        "tried": tried,
    }), 502


@opensign_app.route("/ping", methods=["GET"])
def ping():
    """Health-check: verifies the API key is accepted by OpenSign."""
    if not OPENSIGN_API_KEY:
        return jsonify({"ok": False, "error": "OPENSIGN_API_KEY not set"}), 500

    for endpoint in [
        f"{OPENSIGN_BASE_URL}/api/v1/profile",
        f"{OPENSIGN_BASE_URL}/api/v1/user/me",
        f"{OPENSIGN_BASE_URL}/api/v1/me",
    ]:
        try:
            resp = http_requests.get(endpoint, headers=_headers(), timeout=10)
            if resp.status_code == 404:
                continue
            return jsonify({
                "ok":       resp.ok,
                "status":   resp.status_code,
                "endpoint": endpoint,
                "body":     resp.json() if resp.content else {},
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e), "endpoint": endpoint}), 500

    return jsonify({"ok": False, "error": "No reachable profile endpoint found"}), 502


@opensign_app.route("/webhook", methods=["POST"])
def webhook():
    """
    Called by OpenSign when a document is signed.
    Marks the linked client todo as complete and stores the signed doc URL.
    """
    data           = request.json or {}
    request_id     = data.get("objectId") or data.get("requestId") or data.get("documentId") or ""
    signed_doc_url = data.get("signedDocumentUrl") or data.get("signedUrl") or data.get("fileUrl") or ""
    status         = (data.get("status") or "").lower()

    if status not in ("completed", "signed", "document_signed", ""):
        return jsonify({"ok": True})

    if not request_id:
        return jsonify({"ok": True})

    try:
        db = admin_firestore.client()
        todos_query = db.collection_group("todos").where(
            "opensignRequestId", "==", request_id
        ).limit(5).stream()

        for todo_doc in todos_query:
            update = {"completed": True}
            if signed_doc_url:
                update["signedDocumentUrl"] = signed_doc_url
            todo_doc.reference.update(update)

    except Exception as e:
        print(f"[OpenSign webhook] Error updating todo: {e}")

    return jsonify({"ok": True})
