"""
App Engine Standard proxy — forwards /api/backend/** to Cloud Run (authenticated)
and /api/maps-loader to Secret Manager.

This lives outside GCP's Cloud Run/Functions auth layer, so it is publicly
accessible by default (no allUsers IAM grant needed, org-policy safe).
The App Engine SA (appspot.gserviceaccount.com) already has run.invoker on
the Cloud Run service, so the forwarded requests are accepted.
"""
import os
import urllib.request
from flask import Flask, request, Response, jsonify
import requests as http_requests
from google.cloud import secretmanager

CLOUD_RUN_URL = "https://myclaim-backend-fr6sb3q2na-ue.a.run.app"
PROJECT_ID = "ukrainianrestoration-50993"
_METADATA_IDENTITY = (
    "http://metadata.google.internal/computeMetadata/v1"
    "/instance/service-accounts/default/identity"
    f"?audience={CLOUD_RUN_URL}&format=full"
)

CORS_ORIGINS = {
    "https://ukrainianrestoration.com",
    "https://www.ukrainianrestoration.com",
    "https://ukrainianrestoration-50993.web.app",
    "https://ukrainianrestoration-50993.firebaseapp.com",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
}

app = Flask(__name__)
_secret_client = secretmanager.SecretManagerServiceClient()


@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    if origin in CORS_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


def _get_cr_token():
    """Fetch a Cloud Run identity token via the GCE metadata server.

    fetch_id_token() in recent google-auth versions attempts an IAM API call
    first, which fails in App Engine Standard when the SA lacks
    iam.serviceAccounts.getAccessToken. Calling the metadata endpoint directly
    always works in all GCP runtimes (AE Standard, Cloud Run, GCE, GCF).
    """
    req = urllib.request.Request(
        _METADATA_IDENTITY, headers={"Metadata-Flavor": "Google"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode("utf-8")


def _cors_preflight():
    origin = request.headers.get("Origin", "")
    resp = Response("", 204)
    if origin in CORS_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Max-Age"] = "3600"
    return resp


@app.route("/api/maps-loader", methods=["GET", "OPTIONS"])
def maps_loader():
    if request.method == "OPTIONS":
        return _cors_preflight()
    try:
        name = f"projects/{PROJECT_ID}/secrets/GOOGLE_MAPS_KEY/versions/latest"
        resp = _secret_client.access_secret_version(request={"name": name})
        key = resp.payload.data.decode("utf-8").strip()
        return jsonify({"src": f"https://maps.googleapis.com/maps/api/js?key={key}&libraries=places"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route(
    "/api/backend/",
    defaults={"path": ""},
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
@app.route(
    "/api/backend/<path:path>",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
def backend_proxy(path):
    if request.method == "OPTIONS":
        return _cors_preflight()

    try:
        token = _get_cr_token()
    except Exception as e:
        return jsonify({"error": f"auth: {e}"}), 502

    qs = request.query_string.decode()
    target = f"{CLOUD_RUN_URL}/api/backend/{path}"
    if qs:
        target += f"?{qs}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": request.content_type or "application/json",
    }

    body = request.get_data()
    upstream = http_requests.request(
        request.method,
        target,
        headers=headers,
        data=body,
        timeout=120,
    )
    return Response(
        upstream.content,
        upstream.status_code,
        content_type=upstream.headers.get("Content-Type", "application/json"),
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
