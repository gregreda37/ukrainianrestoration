"""
In-house PDF signing backend.

Flow:
  1. Frontend sends { pdfUrl, signatureDataUrl, signerName, todoId, userId, docName }
  2. We download the original PDF, composite the signature onto the last page
     using PyMuPDF, upload the signed PDF to Firebase Storage, and return
     a public download URL.
"""

import os
import io
import base64
import uuid
from datetime import datetime

import fitz  # PyMuPDF
import requests as http_requests
from flask import Blueprint, request, jsonify
from firebase_admin import auth as admin_auth, storage as admin_storage

signing_app = Blueprint("signing", __name__, url_prefix="/signing")

BUCKET_NAME = os.getenv("FIREBASE_STORAGE_BUCKET", "ukrainianrestoration-50993.appspot.com")


def _verify_token(req):
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        return admin_auth.verify_id_token(header[7:])
    except Exception:
        return None


def _firebase_download_url(bucket_name, blob_name, token):
    """Build a Firebase Storage download URL with an access token."""
    encoded = blob_name.replace("/", "%2F")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}"
        f"/o/{encoded}?alt=media&token={token}"
    )


@signing_app.route("/proxy-pdf", methods=["POST"])
def proxy_pdf():
    """Download a PDF from Firebase Storage server-side and return the bytes.

    Avoids Firebase Storage CORS restrictions in the browser.
    """
    user = _verify_token(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    pdf_url = (request.json or {}).get("url", "").strip()
    if not pdf_url:
        return jsonify({"error": "url required"}), 400

    try:
        resp = http_requests.get(pdf_url, timeout=30)
        resp.raise_for_status()
    except Exception as exc:
        return jsonify({"error": f"Could not fetch PDF: {exc}"}), 502

    from flask import Response
    return Response(
        resp.content,
        content_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@signing_app.route("/sign", methods=["POST"])
def sign_document():
    user = _verify_token(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data           = request.json or {}
    pdf_url        = data.get("pdfUrl",           "").strip()
    sig_data_url   = data.get("signatureDataUrl", "").strip()
    signer_name    = data.get("signerName",       "").strip()
    todo_id        = data.get("todoId",           "unknown")
    user_id        = data.get("userId",           user["uid"])
    doc_name       = data.get("docName",          "document").strip()

    if not pdf_url or not sig_data_url or not signer_name:
        return jsonify({"error": "pdfUrl, signatureDataUrl, and signerName required"}), 400

    # ── Decode signature PNG ─────────────────────────────────────────────────
    sig_bytes = base64.b64decode(sig_data_url.split(",", 1)[-1])

    # ── Download the original PDF ────────────────────────────────────────────
    try:
        resp = http_requests.get(pdf_url, timeout=30)
        resp.raise_for_status()
        pdf_bytes = resp.content
    except Exception as exc:
        return jsonify({"error": f"Could not download PDF: {exc}"}), 502

    # ── Composite signature onto the last page ───────────────────────────────
    try:
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[-1]
        pw, ph = page.rect.width, page.rect.height

        margin   = 36
        block_h  = 110
        block_y0 = ph - block_h - margin
        block_y1 = ph - margin

        # Subtle background + border
        rect = fitz.Rect(margin, block_y0, pw - margin, block_y1)
        page.draw_rect(rect, color=(0.9, 0.93, 0.98), fill=(0.9, 0.93, 0.98))
        page.draw_rect(rect, color=(0.6, 0.7, 0.85), width=0.5)

        # "Electronically signed" label
        page.insert_text(
            fitz.Point(margin + 8, block_y0 + 14),
            "Electronically signed",
            fontsize=7.5, color=(0.45, 0.5, 0.6),
        )

        # Signature image
        sig_rect = fitz.Rect(margin + 8, block_y0 + 18, margin + 200, block_y0 + 78)
        page.insert_image(sig_rect, stream=sig_bytes)

        # Divider line
        page.draw_line(
            fitz.Point(margin + 8, block_y0 + 82),
            fitz.Point(pw - margin - 8, block_y0 + 82),
            color=(0.75, 0.8, 0.88), width=0.4,
        )

        # Signer name
        page.insert_text(
            fitz.Point(margin + 8, block_y0 + 94),
            signer_name,
            fontsize=9.5, color=(0.1, 0.1, 0.2),
        )

        # Date (right-aligned)
        sign_date = datetime.utcnow().strftime("%B %d, %Y")
        date_text = f"Signed {sign_date} (UTC)"
        page.insert_text(
            fitz.Point(pw - margin - 160, block_y0 + 94),
            date_text,
            fontsize=7.5, color=(0.45, 0.5, 0.6),
        )

        signed_bytes = doc.tobytes(garbage=4, deflate=True)
        doc.close()
    except Exception as exc:
        return jsonify({"error": f"Could not process PDF: {exc}"}), 500

    # ── Upload to Firebase Storage ───────────────────────────────────────────
    try:
        bucket    = admin_storage.bucket(BUCKET_NAME)
        safe_name = doc_name.replace(" ", "_").replace("/", "_")
        blob_path = f"signed-documents/{user_id}/{todo_id}/{safe_name}_signed.pdf"
        blob      = bucket.blob(blob_path)

        # Embed a download token so the URL is publicly accessible
        token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_string(signed_bytes, content_type="application/pdf")
        blob.patch()  # persist metadata

        download_url = _firebase_download_url(BUCKET_NAME, blob_path, token)
    except Exception as exc:
        return jsonify({"error": f"Could not save signed PDF: {exc}"}), 500

    return jsonify({"signedDocumentUrl": download_url})
