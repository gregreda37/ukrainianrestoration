"""
Google Drive integration backend.

Setup:
1. Go to console.cloud.google.com → APIs & Services → Enable "Google Drive API"
2. Credentials → Create OAuth 2.0 Client ID (Web Application)
3. Add authorized redirect URI:  http://127.0.0.1:5000/integrations/google-drive/callback
4. Download the JSON file (click the download icon on the credential row)
5. Save it as  backend/client_secret.json
   (or set GOOGLE_SECRETS_FILE in backend/.env to a different path)
6. Optionally set in backend/.env:
     GOOGLE_REDIRECT_URI=http://127.0.0.1:5000/integrations/google-drive/callback
"""

import os
import io
import json
import requests as http_requests
from flask import Blueprint, request, jsonify, redirect, session
from firebase_admin import firestore as admin_firestore
from dotenv import load_dotenv
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

load_dotenv()

drive_app = Blueprint("drive", __name__, url_prefix="/integrations/google-drive")

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

ROOT_FOLDER_NAME = "ukrainianrestoration - myclaim"

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_SECRETS_FILE = os.path.join(
    _BACKEND_DIR,
    os.getenv("GOOGLE_SECRETS_FILE", "client_secret.json"),
)
REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI",
    "http://127.0.0.1:5000/integrations/google-drive/callback",
).strip()

# If running on Cloud Run the JSON is injected via GOOGLE_CLIENT_SECRETS_JSON
# instead of a file on disk. Write it to a temp file so the Flow can read it.
_secrets_json_env = os.getenv("GOOGLE_CLIENT_SECRETS_JSON", "").strip()
if _secrets_json_env and not os.path.exists(_SECRETS_FILE):
    import tempfile
    _tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    _tmp.write(_secrets_json_env)
    _tmp.close()
    _SECRETS_FILE = _tmp.name

# Only allow HTTP OAuth callbacks in local dev — production uses HTTPS
if not REDIRECT_URI.startswith("https://"):
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

# Read CLIENT_ID / CLIENT_SECRET directly from the JSON file so there's no
# copy-paste involved — the file is the authoritative source of truth.
CLIENT_ID     = ""
CLIENT_SECRET = ""
try:
    with open(_SECRETS_FILE) as _f:
        _raw = json.load(_f)
        _web = _raw.get("web") or _raw.get("installed") or {}
        CLIENT_ID     = _web.get("client_id", "")
        CLIENT_SECRET = _web.get("client_secret", "")
except FileNotFoundError:
    pass  # will surface a clear error in the /auth route

_INTEGRATION_COLLECTION = "integrations"
_DRIVE_DOC              = "google_drive"


# ── Helpers ────────────────────────────────────────────────────────────────

def _flow(redirect_uri=None):
    """Build a Flow from the downloaded JSON secrets file."""
    return Flow.from_client_secrets_file(
        _SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri=redirect_uri or REDIRECT_URI,
    )

def _load_credentials(org_id: str):
    """Load and auto-refresh stored OAuth credentials for an org."""
    db = admin_firestore.client()
    snap = db.collection("organization_data").document(org_id) \
             .collection(_INTEGRATION_COLLECTION).document(_DRIVE_DOC).get()
    if not snap.exists:
        return None
    data = snap.to_dict()
    creds = Credentials(
        token         = data.get("access_token"),
        refresh_token = data.get("refresh_token"),
        token_uri     = data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id     = CLIENT_ID,
        client_secret = CLIENT_SECRET,
        scopes        = SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleAuthRequest())
        # Persist refreshed token
        db.collection("organization_data").document(org_id) \
          .collection(_INTEGRATION_COLLECTION).document(_DRIVE_DOC) \
          .update({"access_token": creds.token})
    return creds

def _drive_service(creds):
    return build("drive", "v3", credentials=creds, cache_discovery=False)

def _get_or_create_folder(service, name: str, parent_id=None) -> str:
    """Return the Drive folder ID, creating it if it doesn't exist."""
    q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        q += f" and '{parent_id}' in parents"
    results = service.files().list(q=q, fields="files(id,name)", spaces="drive").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        meta["parents"] = [parent_id]
    folder = service.files().create(body=meta, fields="id").execute()
    return folder["id"]


# ── Routes ─────────────────────────────────────────────────────────────────

@drive_app.route("/auth")
def auth_start():
    """Return the Google OAuth URL as JSON so the frontend can open it in a popup."""
    org_id = request.args.get("orgId", "")
    if not org_id:
        return jsonify({"error": "Missing orgId"}), 400
    if not os.path.exists(_SECRETS_FILE):
        return jsonify({"error": f"client_secret.json not found at {_SECRETS_FILE}"}), 500
    if not CLIENT_ID or not CLIENT_SECRET:
        return jsonify({"error": "Could not read client_id / client_secret from the JSON file."}), 500

    flow = _flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=org_id,
    )
    session["drive_code_verifier"] = getattr(flow, "code_verifier", None)
    return jsonify({"authUrl": auth_url})


@drive_app.route("/callback")
def auth_callback():
    """Exchange authorization code for tokens, store in Firestore, close popup."""
    error  = request.args.get("error")
    if error:
        return _popup_close(success=False, message=f"Google auth error: {error}")

    code   = request.args.get("code", "")
    org_id = request.args.get("state", "")

    if not code or not org_id:
        return _popup_close(success=False, message="Missing code or state")

    try:
        flow = _flow()
        # Restore the PKCE code_verifier that was saved during /auth
        code_verifier = session.pop("drive_code_verifier", None)
        if code_verifier:
            flow.code_verifier = code_verifier
        flow.fetch_token(code=code)
        creds = flow.credentials

        # Create the root folder for this org
        service   = _drive_service(creds)
        root_name = ROOT_FOLDER_NAME
        root_id   = _get_or_create_folder(service, root_name)

        db = admin_firestore.client()
        org_ref = db.collection("organization_data").document(org_id)

        # Store tokens in a restricted sub-collection (never exposed to client SDK)
        org_ref.collection(_INTEGRATION_COLLECTION).document(_DRIVE_DOC).set({
            "access_token":      creds.token,
            "refresh_token":     creds.refresh_token,
            "token_uri":         creds.token_uri,
            "drive_root_folder_id": root_id,
            "connected_at":      admin_firestore.SERVER_TIMESTAMP,
        })

        # Store non-sensitive status on the org doc itself (readable by the frontend)
        org_ref.set({
            "googleDriveConnected": True,
            "googleDriveFolderName": root_name,
        }, merge=True)

        return _popup_close(success=True, message="Google Drive connected!", folder_name=root_name)

    except Exception as e:
        return _popup_close(success=False, message=str(e))


def _popup_close(success: bool, message: str, folder_name: str = "") -> str:
    """Returns an HTML page that sends a postMessage to the opener then closes."""
    payload = json.dumps({"success": success, "message": message, "folderName": folder_name})
    return f"""<!doctype html>
<html><head><title>Google Drive</title></head>
<body>
<script>
  try {{
    window.opener && window.opener.postMessage({payload}, '*');
  }} catch(e) {{}}
  window.close();
</script>
<p>{message}</p>
</body></html>"""


@drive_app.route("/status")
def status():
    """Return whether this org has Google Drive connected."""
    org_id = request.args.get("orgId", "")
    if not org_id:
        return jsonify({"connected": False})
    try:
        db   = admin_firestore.client()
        snap = db.collection("organization_data").document(org_id).get()
        data = snap.to_dict() or {}
        return jsonify({
            "connected":   bool(data.get("googleDriveConnected")),
            "folderName":  data.get("googleDriveFolderName", ""),
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@drive_app.route("/disconnect", methods=["POST"])
def disconnect():
    """Revoke tokens and clear Drive connection for this org."""
    data   = request.json or {}
    org_id = data.get("orgId", "")
    if not org_id:
        return jsonify({"error": "Missing orgId"}), 400
    try:
        db     = admin_firestore.client()
        org_ref = db.collection("organization_data").document(org_id)
        int_ref = org_ref.collection(_INTEGRATION_COLLECTION).document(_DRIVE_DOC)

        snap = int_ref.get()
        if snap.exists:
            token = snap.to_dict().get("access_token", "")
            if token:
                # Best-effort token revocation
                http_requests.post("https://oauth2.googleapis.com/revoke",
                                   params={"token": token}, timeout=5)
            int_ref.delete()

        org_ref.set({"googleDriveConnected": False, "googleDriveFolderName": None}, merge=True)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _get_root_folder_id(db, service, org_id: str) -> str:
    """Return the org root Drive folder ID, creating it if needed."""
    int_ref = db.collection("organization_data").document(org_id) \
                .collection(_INTEGRATION_COLLECTION).document(_DRIVE_DOC)
    data    = (int_ref.get().to_dict() or {})
    root_id = data.get("drive_root_folder_id")
    if not root_id:
        root_id = _get_or_create_folder(service, ROOT_FOLDER_NAME)
        int_ref.update({"drive_root_folder_id": root_id})
    return root_id


@drive_app.route("/create-client-folder", methods=["POST"])
def create_client_folder():
    """
    Ensure the client's Drive folder exists with External Files and Internal Files
    subfolders, then persist all IDs.

    Body: { orgId, phone, clientName, clientDocId? }
    """
    body          = request.json or {}
    org_id        = body.get("orgId", "")
    phone         = body.get("phone", "").strip()
    client_name   = (body.get("clientName") or phone or "Unknown Client").strip()
    client_doc_id = body.get("clientDocId", "").strip()

    if not org_id or not phone:
        return jsonify({"error": "orgId and phone are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        db      = admin_firestore.client()
        service = _drive_service(creds)
        root_id = _get_root_folder_id(db, service, org_id)

        last4        = phone[-4:] if len(phone) >= 4 else phone
        client_label = f"{client_name} (…{last4})" if last4 else client_name
        folder_id    = _get_or_create_folder(service, client_label, root_id)

        # Create Internal Files and External Files directly under client folder
        external_id = _get_or_create_folder(service, "External Files", folder_id)
        internal_id = _get_or_create_folder(service, "Internal Files", folder_id)

        # Build the Google Drive web URL for the client folder
        folder_url = f"https://drive.google.com/drive/folders/{folder_id}"

        drive_data = {
            "driveFolderId":       folder_id,
            "driveFolderName":     client_label,
            "driveFolderUrl":      folder_url,
            "driveExternalFolderId": external_id,
            "driveInternalFolderId": internal_id,
        }

        # Persist on client_phones (existing pattern)
        db.collection("client_phones").document(phone).set(drive_data, merge=True)

        # Also persist on the org client doc so ClientDetail can read it directly
        if client_doc_id:
            db.collection("organization_data").document(org_id) \
              .collection("clients").document(client_doc_id) \
              .set(drive_data, merge=True)

        return jsonify({
            "folderId":       folder_id,
            "folderName":     client_label,
            "folderUrl":      folder_url,
            "externalFolderId": external_id,
            "internalFolderId": internal_id,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/create-claim-folder", methods=["POST"])
def create_claim_folder():
    """
    Create the claim folder and its Documents / Photos sub-folders.

    Body: { orgId, phone, claimId, claimNumber, clientName }
    """
    body         = request.json or {}
    org_id       = body.get("orgId", "")
    phone        = body.get("phone", "").strip()
    claim_id     = body.get("claimId", "").strip()
    claim_number = (body.get("claimNumber") or claim_id).strip()
    client_name  = (body.get("clientName") or phone or "Unknown Client").strip()

    if not org_id or not phone or not claim_id:
        return jsonify({"error": "orgId, phone, and claimId are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        db      = admin_firestore.client()
        service = _drive_service(creds)

        # Get (or create) the client folder
        client_snap = db.collection("client_phones").document(phone).get()
        client_data = client_snap.to_dict() or {}
        client_folder_id = client_data.get("driveFolderId")
        if not client_folder_id:
            root_id       = _get_root_folder_id(db, service, org_id)
            last4         = phone[-4:] if len(phone) >= 4 else phone
            client_label  = f"{client_name} (…{last4})" if last4 else client_name
            client_folder_id = _get_or_create_folder(service, client_label, root_id)
            db.collection("client_phones").document(phone) \
              .set({"driveFolderId": client_folder_id, "driveFolderName": client_label}, merge=True)

        # Claim folder
        claim_label   = f"Claim {claim_number}"
        claim_folder_id = _get_or_create_folder(service, claim_label, client_folder_id)

        # Sub-folders
        client_files_id   = _get_or_create_folder(service, "External Files",   claim_folder_id)
        internal_files_id = _get_or_create_folder(service, "Internal Files", claim_folder_id)

        db.collection("client_phones").document(phone) \
          .collection("claims").document(claim_id) \
          .set({
              "driveFolderId":             claim_folder_id,
              "driveExternalFolderId":  client_files_id,
              "driveInternalFolderId": internal_files_id,
          }, merge=True)

        return jsonify({
            "folderId":             claim_folder_id,
            "clientFilesFolderId":  client_files_id,
            "internalFilesFolderId": internal_files_id,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/rename-claim-folder", methods=["POST"])
def rename_claim_folder():
    """
    Rename the Drive claim folder when a claim number changes.

    Body: { orgId, phone, claimId, newClaimNumber }
    """
    body             = request.json or {}
    org_id           = body.get("orgId", "")
    phone            = body.get("phone", "").strip()
    claim_id         = body.get("claimId", "").strip()
    new_claim_number = body.get("newClaimNumber", "").strip()

    if not org_id or not phone or not claim_id or not new_claim_number:
        return jsonify({"error": "orgId, phone, claimId, and newClaimNumber are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        db         = admin_firestore.client()
        service    = _drive_service(creds)
        claim_snap = db.collection("client_phones").document(phone) \
                      .collection("claims").document(claim_id).get()
        folder_id  = (claim_snap.to_dict() or {}).get("driveFolderId")

        if not folder_id:
            return jsonify({"ok": True, "note": "No Drive folder found for this claim"})

        service.files().update(fileId=folder_id, body={"name": f"Claim {new_claim_number}"}).execute()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/upload", methods=["POST"])
def upload_to_drive():
    """
    Download a file from Firebase Storage and upload it to the org's Google Drive.

    Body:
      orgId            — organization ID
      fileUrl          — publicly accessible download URL
      fileName         — filename to use in Drive
      clientName       — used to name the client sub-folder
      clientPhone      — appended to folder name to keep it unique
      claimNumber      — used to name the claim sub-folder (optional)
      targetFolderId   — if provided, upload here directly (skips folder resolution)
      visibleToClient  — True → "External Files" subfolder, False → "Internal Files" subfolder
    """
    body             = request.json or {}
    org_id           = body.get("orgId", "")
    file_url         = body.get("fileUrl", "")
    file_name        = body.get("fileName", "document")
    client_name      = (body.get("clientName") or body.get("clientPhone") or "Unknown Client").strip()
    client_phone     = (body.get("clientPhone") or "").strip()
    claim_num        = (body.get("claimNumber") or "").strip()
    target_folder_id = (body.get("targetFolderId") or "").strip()
    visible_to_client = body.get("visibleToClient", True)

    if not org_id or not file_url:
        return jsonify({"error": "orgId and fileUrl are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected for this organization"}), 403

    try:
        service = _drive_service(creds)
        db      = admin_firestore.client()

        if not target_folder_id:
            # Fall back to resolving the folder path by name
            root_id = _get_root_folder_id(db, service, org_id)

            last4        = client_phone[-4:] if len(client_phone) >= 4 else client_phone
            client_label = f"{client_name} (…{last4})" if last4 else client_name
            client_folder_id = _get_or_create_folder(service, client_label, root_id)

            target_folder_id = client_folder_id
            if claim_num:
                claim_folder_id  = _get_or_create_folder(service, f"Claim {claim_num}", client_folder_id)
                subfolder_name   = "External Files" if visible_to_client else "Internal Files"
                target_folder_id = _get_or_create_folder(service, subfolder_name, claim_folder_id)

        # Download the file
        resp = http_requests.get(file_url, timeout=30)
        if not resp.ok:
            return jsonify({"error": f"Could not download file: HTTP {resp.status_code}"}), 502

        # Guess MIME type from extension
        ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        mime_map = {
            "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "txt": "text/plain", "csv": "text/csv",
        }
        mime_type = mime_map.get(ext, "application/octet-stream")

        # Upload to Drive
        file_meta = {"name": file_name, "parents": [target_folder_id]}
        media     = MediaIoBaseUpload(io.BytesIO(resp.content), mimetype=mime_type, resumable=False)
        drive_file = service.files().create(
            body=file_meta, media_body=media, fields="id,webViewLink"
        ).execute()

        return jsonify({
            "driveFileId":  drive_file["id"],
            "driveFileUrl": drive_file.get("webViewLink", ""),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/upload-direct", methods=["POST"])
def upload_direct():
    """
    Accept a raw file from the browser and store it directly in Google Drive.
    Use this instead of /upload when Drive is the sole storage (no Firebase URL needed).

    Form fields:
      file            — binary file
      orgId           — organization ID
      phone           — client phone (E.164)
      claimId         — Firestore claim document ID
      claimNumber     — human-readable claim number
      clientName      — client display name
      visibleToClient — "true" | "false"
    """
    org_id       = request.form.get("orgId", "")
    phone        = request.form.get("phone", "").strip()
    claim_id     = request.form.get("claimId", "").strip()
    claim_number = request.form.get("claimNumber", "").strip()
    client_name  = (request.form.get("clientName") or phone or "Unknown Client").strip()
    visible      = request.form.get("visibleToClient", "true").lower() not in ("false", "0", "no")
    file         = request.files.get("file")

    if not org_id or not file:
        return jsonify({"error": "orgId and file are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        db      = admin_firestore.client()
        service = _drive_service(creds)

        # Resolve target folder — check client level first, then claim level
        target_folder_id = ""
        if phone:
            client_data  = (db.collection("client_phones").document(phone).get().to_dict() or {})
            folder_key   = "driveExternalFolderId" if visible else "driveInternalFolderId"
            target_folder_id = client_data.get(folder_key, "")
        if not target_folder_id and claim_id and phone:
            claim_data = (
                db.collection("client_phones").document(phone)
                  .collection("claims").document(claim_id)
                  .get().to_dict() or {}
            )
            folder_key       = "driveExternalFolderId" if visible else "driveInternalFolderId"
            target_folder_id = claim_data.get(folder_key, "")

        if not target_folder_id:
            root_id      = _get_root_folder_id(db, service, org_id)
            last4        = phone[-4:] if len(phone) >= 4 else phone
            client_label = f"{client_name} (…{last4})" if last4 else client_name
            client_fid   = _get_or_create_folder(service, client_label, root_id)
            if claim_number:
                claim_fid        = _get_or_create_folder(service, f"Claim {claim_number}", client_fid)
                subfolder        = "External Files" if visible else "Internal Files"
                target_folder_id = _get_or_create_folder(service, subfolder, claim_fid)
            else:
                target_folder_id = client_fid

        file_name = file.filename or "document"
        ext       = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        mime_map  = {
            "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "txt": "text/plain", "csv": "text/csv",
        }
        mime_type  = mime_map.get(ext, "application/octet-stream")
        file_meta  = {"name": file_name, "parents": [target_folder_id]}
        media      = MediaIoBaseUpload(io.BytesIO(file.read()), mimetype=mime_type, resumable=False)
        drive_file = service.files().create(
            body=file_meta, media_body=media, fields="id,webViewLink"
        ).execute()

        return jsonify({
            "driveFileId":  drive_file["id"],
            "driveFileUrl": drive_file.get("webViewLink", ""),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/sync-claim", methods=["POST"])
def sync_claim():
    """
    List all files in a claim's Client Files and Internal Files Drive subfolders.

    Body: { orgId, phone, claimId }
    Returns: { clientFiles: [...], internalFiles: [...] }
    Each file: { driveFileId, driveFileUrl, name, size, mimeType }
    """
    body     = request.json or {}
    org_id   = body.get("orgId", "")
    phone    = body.get("phone", "").strip()
    claim_id = body.get("claimId", "").strip()

    if not org_id or not phone or not claim_id:
        return jsonify({"error": "orgId, phone, and claimId are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        db      = admin_firestore.client()
        service = _drive_service(creds)

        claim_data = (
            db.collection("client_phones").document(phone)
              .collection("claims").document(claim_id)
              .get().to_dict() or {}
        )
        client_folder_id   = claim_data.get("driveExternalFolderId") or claim_data.get("driveFolderId")
        internal_folder_id = claim_data.get("driveInternalFolderId")

        def list_folder(folder_id):
            if not folder_id:
                return []
            results = service.files().list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields="files(id,name,size,webViewLink,mimeType)",
                spaces="drive",
            ).execute()
            return [
                {
                    "driveFileId":  f["id"],
                    "driveFileUrl": f.get("webViewLink", ""),
                    "name":         f.get("name", ""),
                    "size":         int(f["size"]) if f.get("size") else 0,
                    "mimeType":     f.get("mimeType", ""),
                }
                for f in results.get("files", [])
            ]

        return jsonify({
            "clientFiles":   list_folder(client_folder_id),
            "internalFiles": list_folder(internal_folder_id),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@drive_app.route("/remove-file", methods=["POST"])
def remove_file():
    """
    Delete a file from Google Drive.

    Body: { orgId, driveFileId }
    """
    body          = request.json or {}
    org_id        = body.get("orgId", "")
    drive_file_id = body.get("driveFileId", "").strip()

    if not org_id or not drive_file_id:
        return jsonify({"error": "orgId and driveFileId are required"}), 400

    creds = _load_credentials(org_id)
    if not creds:
        return jsonify({"error": "Google Drive not connected"}), 403

    try:
        service = _drive_service(creds)
        service.files().delete(fileId=drive_file_id).execute()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
