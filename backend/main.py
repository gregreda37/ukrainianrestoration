from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import os

load_dotenv()

# Firebase must be initialized before any blueprint imports that call firestore.client()
import firebase_init
firebase_init.init()

from firebase_admin import auth as admin_auth

from landing_page_model import landing_page_app
from company_chatbot_backend import company_chatbot_app
from claim_chatbot_backend import claim_chatbot_app
from jobs_backend import jobs_app
from fetch_images_model import classify_app
from sms_backend import sms_app
from opensign_backend import opensign_app
from google_drive_backend import drive_app
from signing_backend import signing_app
from ai_analysis_backend import ai_analysis_app
import requests as http_requests
import json as json_lib
from bs4 import BeautifulSoup
from firebase_admin import firestore as admin_firestore

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", os.urandom(24).hex())

# Production origins that must always be allowed, regardless of env var state.
# The CORS_ORIGINS env var extends this list (useful for staging/preview URLs).
_ALWAYS_ALLOWED = [
    "https://ukrainianrestoration.com",
    "https://www.ukrainianrestoration.com",
    "https://ukrainianrestoration-50993.web.app",
    "https://ukrainianrestoration-50993.firebaseapp.com",
]
_cors_env = os.getenv("CORS_ORIGINS", "")
_extra = [o.strip() for o in _cors_env.split(",") if o.strip()]
_cors_origins = list(dict.fromkeys(
    _ALWAYS_ALLOWED + _extra + [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
    ]
))
_cors_set = set(_cors_origins)
CORS(app, origins=_cors_origins, supports_credentials=True,
     allow_headers=["Content-Type", "Authorization", "X-Firebase-ID-Token", "X-Requested-With"],
     methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])

CORS_HEADERS = "Content-Type, Authorization, X-Firebase-ID-Token, X-Requested-With"
CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"

@app.errorhandler(Exception)
def _handle_any_exception(e):
    import traceback
    traceback.print_exc()
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500

@app.errorhandler(404)
def _handle_404(_):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(405)
def _handle_405(_):
    return jsonify({"error": "Method not allowed"}), 405

@app.after_request
def _cors_safety_net(response):
    """Explicit fallback: add CORS headers if flask-cors didn't (e.g. on 4xx/5xx)."""
    origin = request.headers.get("Origin", "")
    if origin not in _cors_set:
        return response
    if "Access-Control-Allow-Origin" not in response.headers:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    if request.method == "OPTIONS":
        response.headers["Access-Control-Allow-Methods"] = CORS_METHODS
        response.headers["Access-Control-Allow-Headers"] = CORS_HEADERS
        response.headers.setdefault("Access-Control-Max-Age", "600")
    return response

# Firebase Hosting rewrites forward the full path including the rewrite prefix
# (e.g. /api/backend/companycam/projects). Strip it so Flask routes match.
_PATH_PREFIX = "/api/backend"

class _StripPrefixMiddleware:
    def __init__(self, wsgi_app):
        self._app = wsgi_app
    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        if path.startswith(_PATH_PREFIX):
            environ["PATH_INFO"] = path[len(_PATH_PREFIX):] or "/"
        return self._app(environ, start_response)

app.wsgi_app = _StripPrefixMiddleware(app.wsgi_app)

app.register_blueprint(landing_page_app, url_prefix="/landing-page")
app.register_blueprint(company_chatbot_app, url_prefix="/company-chatbot")
app.register_blueprint(claim_chatbot_app, url_prefix="/claim-chatbot")
app.register_blueprint(jobs_app, url_prefix="/jobs")
app.register_blueprint(classify_app)
app.register_blueprint(sms_app)
app.register_blueprint(opensign_app)
app.register_blueprint(drive_app)
app.register_blueprint(signing_app)
app.register_blueprint(ai_analysis_app, url_prefix="/ai")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

def _extract_json_ld(soup):
    """Return first Product (or Offer) JSON-LD block found on the page."""
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json_lib.loads(tag.string or "")
        except Exception:
            continue
        # unwrap @graph arrays
        if isinstance(data, dict) and "@graph" in data:
            data = data["@graph"]
        items = data if isinstance(data, list) else [data]
        for item in items:
            t = (item.get("@type") or "")
            if isinstance(t, list):
                t = " ".join(t)
            if "Product" in t or "Offer" in t:
                return item
    return {}

@app.route("/link-preview", methods=["POST"])
def link_preview():
    url = (request.json or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400
    try:
        resp = http_requests.get(url, timeout=8, headers=HEADERS, allow_redirects=True)
        if resp.status_code >= 400:
            return jsonify({"error": f"HTTP {resp.status_code}"}), 400

        soup = BeautifulSoup(resp.text, "lxml")
        ld = _extract_json_ld(soup)

        def ld_val(*keys):
            node = ld
            for k in keys:
                if not isinstance(node, dict):
                    return None
                node = node.get(k)
            return str(node).strip() if node else None

        def og(prop):
            tag = soup.find("meta", property=f"og:{prop}")
            return tag["content"].strip() if tag and tag.get("content") else None

        def meta_name(name):
            tag = soup.find("meta", attrs={"name": name})
            return tag["content"].strip() if tag and tag.get("content") else None

        def itemprop(name):
            tag = soup.find(attrs={"itemprop": name})
            if not tag:
                return None
            return (tag.get("content") or tag.get_text(strip=True) or "").strip() or None

        title = (
            ld_val("name")
            or og("title")
            or itemprop("name")
            or (soup.title.get_text(strip=True) if soup.title else None)
        )
        description = (
            ld_val("description")
            or og("description")
            or itemprop("description")
            or meta_name("description")
        )
        price = (
            ld_val("offers", "price")
            or ld_val("price")
            or og("price:amount")
            or itemprop("price")
        )
        currency = (
            ld_val("offers", "priceCurrency")
            or ld_val("priceCurrency")
            or og("price:currency")
            or itemprop("priceCurrency")
        )
        brand = (
            ld_val("brand", "name")
            or ld_val("brand")
            or og("brand")
            or itemprop("brand")
        )

        return jsonify({
            "title": title,
            "description": description,
            "price": price,
            "currency": currency,
            "brand": brand,
            "url": url,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/photos/companycam", methods=["POST"])
def get_companycam_photos():
    if not _verify_firebase_token():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    project_id = data.get("projectId")
    org_id = data.get("orgId")
    if not project_id or not org_id:
        return jsonify({"error": "Missing projectId or orgId"}), 400
    try:
        db = admin_firestore.client()
        org_snap = db.collection("organization_data").document(org_id).get()
        if not org_snap.exists:
            return jsonify({"error": "Org not found"}), 404
        api_key = org_snap.to_dict().get("companyCamAPI")
        if not api_key:
            return jsonify({"error": "No CompanyCam API key configured for this org"}), 404
        url = f"https://api.companycam.com/v2/projects/{project_id}/photos"
        headers = {"Authorization": f"Bearer {api_key}"}
        all_photos = []
        page = 1
        while True:
            resp = http_requests.get(url, headers=headers, params={"per_page": 100, "page": page}, timeout=15)
            if resp.status_code != 200:
                return jsonify({"error": f"CompanyCam returned {resp.status_code}"}), 502
            raw = resp.json()
            batch = raw if isinstance(raw, list) else raw.get("data", [])
            all_photos.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        return jsonify({"photos": all_photos})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/companycam/projects", methods=["POST"])
def list_companycam_projects():
    if not _verify_firebase_token():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    org_id = data.get("orgId")
    if not org_id:
        return jsonify({"error": "Missing orgId"}), 400
    try:
        db = admin_firestore.client()
        org_snap = db.collection("organization_data").document(org_id).get()
        if not org_snap.exists:
            return jsonify({"error": "Org not found"}), 404
        api_key = org_snap.to_dict().get("companyCamAPI")
        if not api_key:
            return jsonify({"error": "No CompanyCam API key configured for this org"}), 404
        url = "https://api.companycam.com/v2/projects"
        resp = http_requests.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            params={"per_page": 100},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": f"CompanyCam returned {resp.status_code}"}), 502
        raw = resp.json()
        projects = raw if isinstance(raw, list) else raw.get("data", [])
        return jsonify({"projects": projects})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/companycam/projects/create", methods=["POST"])
def create_companycam_project():
    if not _verify_firebase_token():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    org_id = data.get("orgId")
    address = data.get("address")
    if not org_id or not address:
        return jsonify({"error": "Missing orgId or address"}), 400
    try:
        db = admin_firestore.client()
        org_snap = db.collection("organization_data").document(org_id).get()
        if not org_snap.exists:
            return jsonify({"error": "Org not found"}), 404
        api_key = org_snap.to_dict().get("companyCamAPI")
        if not api_key:
            return jsonify({"error": "No CompanyCam API key configured for this org"}), 404
        url = "https://api.companycam.com/v2/projects"
        resp = http_requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"name": address},
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            return jsonify({"error": f"CompanyCam returned {resp.status_code}"}), 502
        return jsonify({"project": resp.json()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/companycam/classify", methods=["POST"])
def companycam_classify_route():
    if not _verify_firebase_token():
        return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    org_id = data.get("orgId")
    project_id = data.get("projectId")
    descriptions = data.get("descriptions") or [
        "Roof Damage", "Water Damage", "Mold", "Structural Damage",
        "Flooring Damage", "Window Damage", "Siding Damage", "Equipment Photo",
    ]
    if not org_id or not project_id:
        return jsonify({"error": "Missing orgId or projectId"}), 400
    try:
        db = admin_firestore.client()
        org_snap = db.collection("organization_data").document(org_id).get()
        if not org_snap.exists:
            return jsonify({"error": "Org not found"}), 404
        api_key = org_snap.to_dict().get("companyCamAPI")
        if not api_key:
            return jsonify({"error": "No CompanyCam API key configured for this org"}), 404
        from fetch_images_model import fetch_companycam_images, classify_images
        images = fetch_companycam_images(project_id, api_key)
        image_urls = []
        for img in images:
            uris = img.get("uris", [])
            url = (
                next((u["url"] for u in uris if u.get("type") == "original"), None)
                or next((u["url"] for u in uris if u.get("type") == "large"), None)
                or (uris[0]["url"] if uris else None)
            )
            if url:
                image_urls.append(url)
        results = classify_images(image_urls, descriptions)
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _verify_firebase_token():
    """
    Verify Firebase ID token from either:
    - X-Firebase-ID-Token header (set by App Engine proxy in production)
    - Authorization: Bearer header (local dev, no proxy)
    Returns the decoded token dict, or None if missing/invalid.
    """
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


@app.route("/health")
def health():
    return jsonify({"status": "ok", "cors_origins": _cors_origins})


if __name__ == "__main__":
    print("Starting the backend server...")
    app.run(debug=True, port=5001)