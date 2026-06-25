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
from firebase_admin import auth as admin_auth, storage as admin_storage, firestore as admin_firestore

signing_app = Blueprint("signing", __name__, url_prefix="/signing")

BUCKET_NAME = os.getenv("FIREBASE_STORAGE_BUCKET", "ukrainianrestoration-50993.firebasestorage.app")


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
    """Place template fields onto the document pages.

    Coordinates (x, y, w, h) are fractions [0, 1] of page.rect dimensions.
    PyMuPDF's normalized coordinate system has origin at page.rect top-left,
    so fractional positions map correctly regardless of MediaBox/CropBox offsets.
    """
    for field in fields:
        pi = int(field.get("pageIndex", 0))
        pi = max(0, min(pi, len(doc) - 1))
        page = doc[pi]
        pw, ph = page.rect.width, page.rect.height

        fx = float(field.get("x", 0)) * pw
        fy = float(field.get("y", 0)) * ph
        fw = float(field.get("w", 0.2)) * pw
        fh = float(field.get("h", 0.05)) * ph

        if fw <= 0 or fh <= 0:
            continue

        rect  = fitz.Rect(fx, fy, fx + fw, fy + fh)
        ftype = field.get("type", "signature")
        val   = field.get("value", "")

        try:
            if ftype in ("signature", "initials") and val:
                img_bytes = base64.b64decode(val.split(",", 1)[-1])
                # overlay=True ensures signatures render on top of any existing
                # content (client signatures already embedded, form backgrounds).
                page.insert_image(rect, stream=img_bytes, keep_proportion=False, overlay=True)

            elif ftype in ("date", "text") and val:
                page.insert_textbox(
                    rect, val,
                    fontsize=max(7, fh * 0.45),
                    color=(0.1, 0.1, 0.2),
                    align=0,
                    overlay=True,
                )
        except Exception as exc:
            print(f"[composite_fields] skipping field type={ftype} page={pi} rect={rect}: {exc}")


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


def _render_cert_page(doc, title, sections):
    """
    Generic helper: appends one audit page.

    sections = list of dicts:
      { "heading": str, "color": rgb_tuple,
        "rows": [(label, value), ...],
        "items": [str, ...] }   # bulleted list entries (optional)
    """
    page   = doc.new_page(width=612, height=792)

    navy   = (0.04, 0.15, 0.35)
    gray   = (0.38, 0.38, 0.40)
    hdr_bg = (0.06, 0.18, 0.46)
    box_bg = (0.94, 0.96, 1.00)
    line_c = (0.78, 0.82, 0.90)

    y = 36

    # Header bar
    page.draw_rect(fitz.Rect(36, y, 576, y + 44), color=hdr_bg, fill=hdr_bg)
    page.insert_textbox(
        fitz.Rect(40, y + 4, 572, y + 40),
        title,
        fontsize=14, color=(1, 1, 1), align=1,
    )
    y += 56

    for sec in sections:
        color   = sec.get("color", navy)
        heading = sec.get("heading", "")
        if heading:
            page.insert_text(fitz.Point(40, y), heading, fontsize=9.5, color=color, fontname="helv")
            page.draw_line(fitz.Point(40, y + 3), fitz.Point(576, y + 3), color=line_c, width=0.6)
            y += 16

        for (label, value) in sec.get("rows", []):
            v = str(value or "-")[:90]
            page.insert_text(fitz.Point(46, y),  label, fontsize=8, color=gray,             fontname="helv")
            page.insert_text(fitz.Point(168, y), v,     fontsize=8, color=(0.06, 0.08, 0.14), fontname="helv")
            y += 12

        for item in sec.get("items", []):
            page.insert_text(fitz.Point(54, y), str(item)[:80], fontsize=7.5, color=(0.10, 0.38, 0.18), fontname="helv")
            y += 11

        y += 8

    # Legal notice
    notice = (
        "This certificate is an audit record of electronic signatures applied to this "
        "document via MyClaim. Signers were authenticated via Firebase authentication. "
        "IP addresses and timestamps are captured for legal and compliance purposes. "
        "Legally binding under the ESIGN Act, eIDAS Regulation, and applicable statutes."
    )
    page.draw_rect(fitz.Rect(36, y, 576, y + 52), color=box_bg, fill=box_bg)
    page.insert_textbox(
        fitz.Rect(42, y + 5, 570, y + 48),
        notice, fontsize=7.2, color=(0.30, 0.33, 0.42), align=0,
    )
    y += 62

    # Footer
    page.draw_line(fitz.Point(36, y), fitz.Point(576, y), color=line_c, width=0.4)
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    page.insert_text(
        fitz.Point(40, y + 11),
        f"Generated by MyClaim  |  {generated_at} UTC",
        fontsize=7, color=(0.52, 0.55, 0.62), fontname="helv",
    )


def _add_certificate_page(doc, audit):
    """Append a client-signing certificate page (single-signer mode)."""

    def _field_items(fields):
        items = []
        for f in (fields or []):
            ftype = (f.get("type") or "field").capitalize()
            pg    = int(f.get("pageIndex", 0)) + 1
            val   = f.get("value", "")
            if ftype.lower() in ("signature", "initials"):
                items.append(f"[signed]   {ftype}  —  Page {pg}")
            else:
                snippet = str(val)[:50]
                items.append(f"[filled]   {ftype}  —  Page {pg}  :  {snippet}")
        return items

    _render_cert_page(doc, "ELECTRONIC SIGNATURE CERTIFICATE", [
        {
            "heading": "Document Information",
            "rows": [
                ("Document Name:", audit.get("docName", "-")),
                ("Document ID:",   audit.get("todoId",  "-")),
            ],
        },
        {
            "heading": "Signer",
            "color":   (0.04, 0.18, 0.50),
            "rows": [
                ("Full Name:",  audit.get("signerName",  "-")),
                ("Email:",      audit.get("signerEmail", "") or "-"),
                ("Phone:",      audit.get("signerPhone", "") or "-"),
                ("IP Address:", audit.get("signerIp",    "") or "-"),
                ("User Agent:", (audit.get("userAgent",  "") or "-")[:80]),
                ("Signed At:",  (audit.get("signedAt",   "-")) + " UTC"),
            ],
            "items": _field_items(audit.get("fields", [])),
        },
        {
            "heading": "Contractor Authorization",
            "color":   (0.04, 0.30, 0.12),
            "rows": [
                ("Contractor:",    (audit.get("contractor") or {}).get("name",     "") or "Pending"),
                ("Email:",         (audit.get("contractor") or {}).get("email",    "") or "-"),
                ("IP Address:",    (audit.get("contractor") or {}).get("ip",       "") or "-"),
                ("Authorized At:", (audit.get("contractor") or {}).get("signedAt", "") or "Pending"),
            ],
        } if audit.get("contractor") else {},
    ])


def _add_combined_certificate(doc, client_audit, contractor_audit):
    """
    Replace the existing client-only certificate page (last page) with a
    comprehensive certificate covering both the client and the contractor.
    Call this AFTER removing the old cert page.
    """

    def _field_items(fields):
        items = []
        for f in (fields or []):
            ftype = (f.get("type") or "field").capitalize()
            pg    = int(f.get("pageIndex", 0)) + 1
            val   = f.get("value", "")
            if ftype.lower() in ("signature", "initials"):
                items.append(f"[signed]   {ftype}  —  Page {pg}")
            else:
                snippet = str(val)[:50]
                items.append(f"[filled]   {ftype}  —  Page {pg}  :  {snippet}")
        return items

    client_fields = _field_items(client_audit.get("fields", []))
    ctr_fields    = _field_items(contractor_audit.get("fields", []))

    sections = [
        {
            "heading": "Document Information",
            "rows": [
                ("Document Name:", client_audit.get("docName", contractor_audit.get("docName", "-"))),
                ("Document ID:",   client_audit.get("todoId",  contractor_audit.get("todoId",  "-"))),
            ],
        },
        {
            "heading": "Client Signature",
            "color":   (0.04, 0.18, 0.50),
            "rows": [
                ("Full Name:",  client_audit.get("name",      "") or client_audit.get("signerName", "-")),
                ("Email:",      client_audit.get("email",     "") or client_audit.get("signerEmail","") or "-"),
                ("IP Address:", client_audit.get("ip",        "") or client_audit.get("signerIp",  "") or "-"),
                ("Signed At:",  (client_audit.get("signedAt", "") or "-") + " UTC"),
            ],
            "items": client_fields,
        },
        {
            "heading": "Contractor Authorization",
            "color":   (0.04, 0.30, 0.12),
            "rows": [
                ("Full Name:",     contractor_audit.get("name",     "-")),
                ("Email:",         contractor_audit.get("email",    "") or "-"),
                ("IP Address:",    contractor_audit.get("ip",       "") or "-"),
                ("Authorized At:", (contractor_audit.get("signedAt","") or "-") + " UTC"),
            ],
            "items": ctr_fields,
        },
    ]

    _render_cert_page(doc, "ELECTRONIC SIGNATURE CERTIFICATE", sections)


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
    signer_email = data.get("signerEmail",     "").strip()
    signer_ip    = data.get("signerIp",        "").strip()
    signer_phone = data.get("signerPhone",     "").strip()
    user_agent   = data.get("userAgent",       "").strip()

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

        signed_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        _add_certificate_page(doc, {
            "docName":     doc_name,
            "todoId":      todo_id,
            "signerName":  signer_name,
            "signerEmail": signer_email,
            "signerPhone": signer_phone,
            "signerIp":    signer_ip,
            "userAgent":   user_agent,
            "signedAt":    signed_at,
            "fields":      fields or [],
        })
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
        blob.upload_from_string(signed_bytes, content_type="application/pdf")
        blob.reload()
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.patch()

        download_url = _firebase_download_url(BUCKET_NAME, blob_path, token)
    except Exception as exc:
        return jsonify({"error": f"Could not save signed PDF: {exc}"}), 500

    # ── Persist client audit metadata to Firestore for use in combined cert ──
    client_audit_data = {
        "name":      signer_name,
        "email":     signer_email,
        "ip":        signer_ip,
        "signedAt":  signed_at,
        "docName":   doc_name,
        "todoId":    todo_id,
        "fields":    fields or [],
    }
    if todo_id and todo_id != "unknown" and user_id and user_id != "unknown":
        try:
            db = admin_firestore.client()
            db.collection("users").document(user_id).collection("todos").document(todo_id).update({
                "clientAudit": client_audit_data,
            })
        except Exception as exc:
            print(f"[sign] Could not persist clientAudit to Firestore: {exc}")

    return jsonify({"signedDocumentUrl": download_url})


# ── Contractor counter-sign ──────────────────────────────────────────────────

@signing_app.route("/contractor-sign", methods=["POST"])
def contractor_sign():
    user = _verify_token(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data               = request.json or {}
    signed_pdf_url     = data.get("signedPdfUrl",     "").strip()
    contractor_name    = data.get("contractorName",   "").strip()
    sig_data_url       = data.get("signatureDataUrl", "").strip()
    todo_id            = data.get("todoId",           "unknown")
    client_uid         = data.get("clientUid",        "")
    doc_name           = data.get("docName",          "document").strip()
    contractor_email   = data.get("contractorEmail",  "").strip()
    contractor_ip      = data.get("contractorIp",     "").strip()
    contractor_fields  = data.get("contractorFields") # list of positioned fields, or None

    if not signed_pdf_url or not sig_data_url or not contractor_name:
        return jsonify({"error": "signedPdfUrl, signatureDataUrl, and contractorName required"}), 400

    # ── Download client-signed PDF ───────────────────────────────────────────
    try:
        resp = http_requests.get(signed_pdf_url, timeout=30)
        resp.raise_for_status()
        pdf_bytes = resp.content
    except Exception as exc:
        return jsonify({"error": f"Could not download signed PDF: {exc}"}), 502

    # ── Read client audit metadata from Firestore ────────────────────────────
    client_audit = {}
    if client_uid and todo_id and todo_id != "unknown":
        try:
            db          = admin_firestore.client()
            todo_snap   = db.collection("users").document(client_uid).collection("todos").document(todo_id).get()
            if todo_snap.exists:
                client_audit = todo_snap.get("clientAudit") or {}
        except Exception as exc:
            print(f"[contractor-sign] Could not read clientAudit from Firestore: {exc}")

    # ── Apply contractor signatures ──────────────────────────────────────────
    try:
        sig_bytes = base64.b64decode(sig_data_url.split(",", 1)[-1])
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        # Log what we received so positioning issues are visible in Cloud Run logs
        print(f"[contractor-sign] todo={todo_id} contractor_fields={contractor_fields!r} "
              f"doc_pages={len(doc)}")

        if contractor_fields is not None and len(contractor_fields) > 0:
            # Template-positioned or ad-hoc fields — use exact coordinates
            print(f"[contractor-sign] template/adhoc mode: {len(contractor_fields)} field(s)")
            _composite_fields(doc, contractor_fields)
        elif contractor_fields is not None and len(contractor_fields) == 0:
            # Explicitly empty list — no contractor sig placement needed
            print("[contractor-sign] empty field list — no placement")
        else:
            # Legacy fallback: fixed block on last content page (page before client cert)
            print("[contractor-sign] legacy fallback mode")
            page = doc[max(0, len(doc) - 2)]
            pw, ph = page.rect.width, page.rect.height
            margin  = 30
            block_h = 85
            block_w = (pw - 2 * margin) * 0.46
            bx0 = pw - margin - block_w
            by0 = ph - block_h - margin
            bx1 = pw - margin
            by1 = ph - margin

            page.draw_rect(fitz.Rect(bx0, by0, bx1, by1), color=(0.88, 0.92, 0.88), fill=(0.88, 0.92, 0.88))
            page.draw_rect(fitz.Rect(bx0, by0, bx1, by1), color=(0.5, 0.7, 0.5), width=0.6)
            page.insert_text(fitz.Point(bx0 + 6, by0 + 12), "Contractor Authorization",
                             fontsize=7, color=(0.3, 0.45, 0.3))
            page.insert_image(fitz.Rect(bx0 + 6, by0 + 16, bx0 + block_w * 0.65, by0 + 60),
                              stream=sig_bytes)
            page.draw_line(fitz.Point(bx0 + 6, by0 + 64), fitz.Point(bx1 - 6, by0 + 64),
                           color=(0.6, 0.75, 0.6), width=0.4)
            page.insert_text(fitz.Point(bx0 + 6, by0 + 74), contractor_name,
                             fontsize=8.5, color=(0.1, 0.2, 0.1))
            page.insert_text(fitz.Point(bx0 + block_w * 0.55, by0 + 74),
                             datetime.utcnow().strftime("%B %d, %Y"),
                             fontsize=7, color=(0.35, 0.45, 0.35))

        ctr_signed_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        # Remove the client-only certificate page (always the last page added by /sign)
        # and replace it with a single comprehensive combined certificate.
        if len(doc) > 1:
            doc.delete_page(-1)

        _add_combined_certificate(doc,
            client_audit={
                **client_audit,
                "docName": doc_name,
                "todoId":  todo_id,
            },
            contractor_audit={
                "name":     contractor_name,
                "email":    contractor_email,
                "ip":       contractor_ip,
                "signedAt": ctr_signed_at,
                "fields":   contractor_fields or [],
            },
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
        blob.upload_from_string(signed_bytes, content_type="application/pdf")
        blob.reload()
        blob.metadata = {"firebaseStorageDownloadTokens": token}
        blob.patch()
        countersigned_url = _firebase_download_url(BUCKET_NAME, blob_path, token)

        # Copy into client document files
        client_blob_path = f"users/{client_uid}/documents/{safe_name}_countersigned.pdf"
        client_blob = bucket.blob(client_blob_path)
        client_token = str(uuid.uuid4())
        client_blob.upload_from_string(signed_bytes, content_type="application/pdf")
        client_blob.reload()
        client_blob.metadata = {"firebaseStorageDownloadTokens": client_token}
        client_blob.patch()
        client_doc_url = _firebase_download_url(BUCKET_NAME, client_blob_path, client_token)

    except Exception as exc:
        return jsonify({"error": f"Could not save countersigned PDF: {exc}"}), 500

    return jsonify({
        "contractorSignedDocUrl": countersigned_url,
        "clientDocUrl":           client_doc_url,
    })
