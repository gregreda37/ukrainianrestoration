"""
In-house PDF signing backend.

Two modes:
  fields mode  — template-placed fields (signature, initials, date) composited
                 at precise fractional positions using PyMuPDF.
  legacy mode  — single full-page signature block at bottom of last page
                 (used when no templateFields are attached to the todo).
"""

import os
import base64
import uuid
from datetime import datetime

import fitz  # PyMuPDF
import requests as http_requests
from flask import Blueprint, request, jsonify, Response
from firebase_admin import auth as admin_auth, storage as admin_storage

signing_app = Blueprint("signing", __name__, url_prefix="/signing")

BUCKET_NAME = os.getenv("FIREBASE_STORAGE_BUCKET", "ukrainianrestoration-50993.appspot.com")


def _verify_token(req):
    # When running behind the App Engine proxy the proxy replaces Authorization
    # with its own Cloud Run identity token and forwards the original Firebase
    # user token under X-Firebase-ID-Token.  Fall back to Authorization for
    # local dev (no proxy).
    header = (
        req.headers.get("X-Firebase-ID-Token", "")
        or req.headers.get("Authorization", "")
    )
    if not header.startswith("Bearer "):
        return None
    try:
        return admin_auth.verify_id_token(header[7:])
    except Exception as exc:
        print(f"[signing] verify_id_token failed: {exc}")
        return None


def _firebase_download_url(bucket_name, blob_name, token):
    encoded = blob_name.replace("/", "%2F")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}"
        f"/o/{encoded}?alt=media&token={token}"
    )


# ── PDF proxy ────────────────────────────────────────────────────────────────

@signing_app.route("/proxy-pdf", methods=["POST"])
def proxy_pdf():
    """Download a PDF from Firebase Storage server-side, bypassing browser CORS."""
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

    return Response(resp.content, content_type="application/pdf",
                    headers={"Content-Disposition": "inline"})


# ── Sign ─────────────────────────────────────────────────────────────────────

def _composite_fields(doc, fields):
    """Place template fields onto the document pages."""
    for field in fields:
        pi = int(field.get("pageIndex", 0))
        pi = max(0, min(pi, len(doc) - 1))
        page = doc[pi]
        pw, ph = page.rect.width, page.rect.height

        fx = float(field.get("x", 0)) * pw
        fy = float(field.get("y", 0)) * ph
        fw = float(field.get("w", 0.2)) * pw
        fh = float(field.get("h", 0.05)) * ph
        rect = fitz.Rect(fx, fy, fx + fw, fy + fh)

        ftype = field.get("type", "signature")
        val   = field.get("value", "")

        if ftype in ("signature", "initials") and val:
            img_bytes = base64.b64decode(val.split(",", 1)[-1])
            tint = (0.9, 0.93, 0.98) if ftype == "signature" else (0.92, 0.98, 0.94)
            page.draw_rect(rect, color=tint, fill=tint)
            page.insert_image(rect, stream=img_bytes)

        elif ftype in ("date", "text") and val:
            bg = (0.98, 0.97, 0.9) if ftype == "date" else (0.97, 0.95, 1.0)
            page.draw_rect(rect, color=bg, fill=bg)
            page.insert_textbox(
                rect, val,
                fontsize=max(7, fh * 0.45),
                color=(0.1, 0.1, 0.2),
                align=0,
            )


def _composite_legacy(doc, sig_bytes, signer_name):
    """Single signature block at the bottom of the last page."""
    page = doc[-1]
    pw, ph = page.rect.width, page.rect.height

    margin   = 36
    block_h  = 110
    block_y0 = ph - block_h - margin
    block_y1 = ph - margin

    rect = fitz.Rect(margin, block_y0, pw - margin, block_y1)
    page.draw_rect(rect, color=(0.9, 0.93, 0.98), fill=(0.9, 0.93, 0.98))
    page.draw_rect(rect, color=(0.6, 0.7, 0.85), width=0.5)

    page.insert_text(
        fitz.Point(margin + 8, block_y0 + 14),
        "Electronically signed",
        fontsize=7.5, color=(0.45, 0.5, 0.6),
    )

    sig_rect = fitz.Rect(margin + 8, block_y0 + 18, margin + 200, block_y0 + 78)
    page.insert_image(sig_rect, stream=sig_bytes)

    page.draw_line(
        fitz.Point(margin + 8,      block_y0 + 82),
        fitz.Point(pw - margin - 8, block_y0 + 82),
        color=(0.75, 0.8, 0.88), width=0.4,
    )

    page.insert_text(
        fitz.Point(margin + 8, block_y0 + 94),
        signer_name,
        fontsize=9.5, color=(0.1, 0.1, 0.2),
    )

    sign_date = datetime.utcnow().strftime("%B %d, %Y")
    page.insert_text(
        fitz.Point(pw - margin - 160, block_y0 + 94),
        f"Signed {sign_date} (UTC)",
        fontsize=7.5, color=(0.45, 0.5, 0.6),
    )


@signing_app.route("/sign", methods=["POST"])
def sign_document():
    user = _verify_token(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data         = request.json or {}
    pdf_url      = data.get("pdfUrl",          "").strip()
    signer_name  = data.get("signerName",      "").strip()
    todo_id      = data.get("todoId",          "unknown")
    user_id      = data.get("userId",          user["uid"])
    doc_name     = data.get("docName",         "document").strip()
    fields       = data.get("fields")          # list of field objects, or None
    sig_data_url = data.get("signatureDataUrl","").strip()   # legacy

    if not pdf_url:
        return jsonify({"error": "pdfUrl required"}), 400
    if not signer_name:
        return jsonify({"error": "signerName required"}), 400

    # ── Download original PDF ────────────────────────────────────────────────
    try:
        resp = http_requests.get(pdf_url, timeout=30)
        resp.raise_for_status()
        pdf_bytes = resp.content
    except Exception as exc:
        return jsonify({"error": f"Could not download PDF: {exc}"}), 502

    # ── Composite fields ─────────────────────────────────────────────────────
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        if fields:
            _composite_fields(doc, fields)
        elif sig_data_url:
            sig_bytes = base64.b64decode(sig_data_url.split(",", 1)[-1])
            _composite_legacy(doc, sig_bytes, signer_name)
        else:
            return jsonify({"error": "fields or signatureDataUrl required"}), 400

        signed_bytes = doc.tobytes(garbage=4, deflate=True)
        doc.close()
    except Exception as exc:
        return jsonify({"error": f"Could not process PDF: {exc}"}), 500

    # ── Upload signed PDF ────────────────────────────────────────────────────
    try:
        bucket    = admin_storage.bucket(BUCKET_NAME)
        safe_name = doc_name.replace(" ", "_").replace("/", "_")
        blob_path = f"signed-documents/{user_id}/{todo_id}/{safe_name}_signed.pdf"
        blob      = bucket.blob(blob_path)

        token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_string(signed_bytes, content_type="application/pdf")
        blob.patch()

        download_url = _firebase_download_url(BUCKET_NAME, blob_path, token)
    except Exception as exc:
        return jsonify({"error": f"Could not save signed PDF: {exc}"}), 500

    return jsonify({"signedDocumentUrl": download_url})


# ── Contractor counter-sign ──────────────────────────────────────────────────

@signing_app.route("/contractor-sign", methods=["POST"])
def contractor_sign():
    user = _verify_token(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data            = request.json or {}
    signed_pdf_url  = data.get("signedPdfUrl",    "").strip()
    contractor_name = data.get("contractorName",  "").strip()
    sig_data_url    = data.get("signatureDataUrl","").strip()
    todo_id         = data.get("todoId",          "unknown")
    client_uid      = data.get("clientUid",       "")
    doc_name        = data.get("docName",         "document").strip()

    if not signed_pdf_url or not sig_data_url or not contractor_name:
        return jsonify({"error": "signedPdfUrl, signatureDataUrl, and contractorName required"}), 400

    # ── Download client-signed PDF ───────────────────────────────────────────
    try:
        resp = http_requests.get(signed_pdf_url, timeout=30)
        resp.raise_for_status()
        pdf_bytes = resp.content
    except Exception as exc:
        return jsonify({"error": f"Could not download signed PDF: {exc}"}), 502

    # ── Add contractor block on last page ────────────────────────────────────
    try:
        sig_bytes = base64.b64decode(sig_data_url.split(",", 1)[-1])
        doc  = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[-1]
        pw, ph = page.rect.width, page.rect.height

        margin   = 30
        block_h  = 85
        block_w  = (pw - 2 * margin) * 0.46
        bx0      = pw - margin - block_w
        by0      = ph - block_h - margin
        bx1      = pw - margin
        by1      = ph - margin

        # Background
        rect = fitz.Rect(bx0, by0, bx1, by1)
        page.draw_rect(rect, color=(0.88, 0.92, 0.88), fill=(0.88, 0.92, 0.88))
        page.draw_rect(rect, color=(0.5, 0.7, 0.5), width=0.6)

        page.insert_text(
            fitz.Point(bx0 + 6, by0 + 12),
            "Contractor Authorization",
            fontsize=7, color=(0.3, 0.45, 0.3),
        )

        sig_rect = fitz.Rect(bx0 + 6, by0 + 16, bx0 + block_w * 0.65, by0 + 60)
        page.insert_image(sig_rect, stream=sig_bytes)

        page.draw_line(
            fitz.Point(bx0 + 6, by0 + 64),
            fitz.Point(bx1 - 6, by0 + 64),
            color=(0.6, 0.75, 0.6), width=0.4,
        )

        page.insert_text(
            fitz.Point(bx0 + 6, by0 + 74),
            contractor_name,
            fontsize=8.5, color=(0.1, 0.2, 0.1),
        )

        sign_date = datetime.utcnow().strftime("%B %d, %Y")
        page.insert_text(
            fitz.Point(bx0 + block_w * 0.55, by0 + 74),
            sign_date,
            fontsize=7, color=(0.35, 0.45, 0.35),
        )

        signed_bytes = doc.tobytes(garbage=4, deflate=True)
        doc.close()
    except Exception as exc:
        return jsonify({"error": f"Could not process PDF: {exc}"}), 500

    # ── Upload countersigned PDF ─────────────────────────────────────────────
    try:
        bucket = admin_storage.bucket(BUCKET_NAME)
        safe_name = doc_name.replace(" ", "_").replace("/", "_")

        # Primary path
        blob_path = f"signed-documents/{client_uid}/{todo_id}/countersigned.pdf"
        blob = bucket.blob(blob_path)
        token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.upload_from_string(signed_bytes, content_type="application/pdf")
        blob.patch()
        countersigned_url = _firebase_download_url(BUCKET_NAME, blob_path, token)

        # Copy into client document files
        client_blob_path = f"users/{client_uid}/documents/{safe_name}_countersigned.pdf"
        client_blob = bucket.blob(client_blob_path)
        client_token = str(uuid.uuid4())
        client_blob.metadata = {"firebaseStorageDownloadTokens": client_token}
        client_blob.upload_from_string(signed_bytes, content_type="application/pdf")
        client_blob.patch()
        client_doc_url = _firebase_download_url(BUCKET_NAME, client_blob_path, client_token)

    except Exception as exc:
        return jsonify({"error": f"Could not save countersigned PDF: {exc}"}), 500

    return jsonify({
        "contractorSignedDocUrl": countersigned_url,
        "clientDocUrl":           client_doc_url,
    })
