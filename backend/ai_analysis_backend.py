import os
import json
import base64
import hashlib
import requests
# redeploy: secret version now exists, CORS safety-net in main.py
import anthropic
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify, Response, stream_with_context
from firebase_admin import firestore as admin_firestore, auth as admin_auth

ai_analysis_app = Blueprint("ai_analysis_app", __name__)

CLAUDE_MODEL = "claude-haiku-4-5-20251001"
ALLOWED_MODELS = {
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
}
CACHE_TTL_MINUTES = 30

MITIGATION_LABELS = [
    "Claim Submitted", "Mitigation in Progress", "Mitigation Completed",
    "Estimate Submitted", "Estimate Approved",
]
CONSTRUCTION_LABELS = [
    "Construction Estimate Received", "Construction Estimate Approved",
    "Construction Beginning", "Construction Completes",
]

SYSTEM_PROMPT = """You are an expert restoration claim analyst for Ukrainian Restoration, a property damage and restoration construction company. You specialize in insurance claims, water/fire/storm damage assessment, construction timelines, and client management.

You have been given a complete client case file and have access to their claim information, uploaded documents, CompanyCam site photos, tasks, material selections, budget, and activity history.

Your role:
- Provide specific, data-grounded analysis based on the actual case file provided
- Identify missing documentation, incomplete tasks, or risks that could slow the claim
- Analyze property damage from photos when available — be specific about damage types and scope
- Help the contractor prioritize next steps and flag urgencies
- Generate clear summaries and client-ready reports when asked
- Flag concerns about timeline, budget discrepancies, or claim status

Always cite specific numbers, names, and dates from the case file. Be direct and actionable."""


# ── Auth ─────────────────────────────────────────────────────────────────────

def _require_auth():
    """Verify Firebase ID token. Returns (uid, None) on success or (None, error_response).

    Token is passed in the request JSON body as `idToken` — same pattern as
    CompanyCam (body-only, no custom headers). This avoids custom CORS headers
    in the preflight and survives Firebase Hosting's Authorization replacement.
    Falls back to Authorization: Bearer for direct curl/test calls.
    """
    body = request.get_json(silent=True) or {}
    token = body.get("idToken", "")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    try:
        decoded = admin_auth.verify_id_token(token)
        return decoded["uid"], None
    except Exception:
        return None, (jsonify({"error": "Invalid or expired token"}), 401)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ts_str(ts):
    if ts is None:
        return "N/A"
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d %H:%M")
    return str(ts)


def _flags_hash(context_flags):
    return hashlib.sha256(
        json.dumps(context_flags, sort_keys=True).encode()
    ).hexdigest()[:12]


# ── Context builder ───────────────────────────────────────────────────────────

def _build_context(db, org_id, client_uid, context_flags, client_name_hint=""):
    """Build context string + supporting data from Firestore + CompanyCam."""
    lines = []
    stats = {}

    user_doc = db.collection("users").document(client_uid).get()
    if not user_doc.exists:
        return None, None, [], {}

    ud = user_doc.to_dict()
    mit_step = ud.get("mitigationStep", -1)
    con_step = ud.get("constructionStep", -1)
    adj = ud.get("adjuster") or {}

    # Prefer Firebase Auth displayName, fall back to org client doc name
    display_name = ud.get("displayName") or client_name_hint or "Unknown"

    client_summary = {
        "name": display_name,
        "email": ud.get("email", ""),
        "phone": ud.get("phoneNumber", ""),
        "address": ud.get("address", ""),
        "claimNumbers": ud.get("claimNumbers", []),
        "policyNumber": ud.get("policyNumber", ""),
        "mitigationStep": mit_step,
        "constructionStep": con_step,
        "adjuster": adj,
        "companyCamProjectId": ud.get("companyCamProjectId", ""),
    }

    lines.append("## CLIENT INFORMATION")
    lines.append(f"Name: {display_name}")
    lines.append(f"Email: {ud.get('email', 'N/A')}")
    lines.append(f"Phone: {ud.get('phoneNumber', 'N/A')}")
    lines.append(f"Address: {ud.get('address', 'N/A')}")
    claim_nums = ud.get("claimNumbers") or []
    lines.append(f"Claim Number(s): {', '.join(claim_nums) or 'N/A'}")
    lines.append(f"Policy Number: {ud.get('policyNumber', 'N/A')}")

    mit_label = MITIGATION_LABELS[mit_step] if 0 <= mit_step < len(MITIGATION_LABELS) else "Not started"
    con_label = CONSTRUCTION_LABELS[con_step] if 0 <= con_step < len(CONSTRUCTION_LABELS) else "Not started"
    lines.append(f"\n## PROGRESS STATUS")
    lines.append(f"Mitigation: Step {mit_step + 1 if mit_step >= 0 else 0}/{len(MITIGATION_LABELS)} — {mit_label}")
    lines.append(f"Construction: {con_label}")

    if any(v for v in adj.values() if v):
        lines.append(f"\n## ADJUSTER INFORMATION")
        for k, v in adj.items():
            if v:
                lines.append(f"{k.replace('_', ' ').title()}: {v}")

    # Todos
    todos_snap = db.collection("users").document(client_uid).collection("todos").get()
    todos = [t.to_dict() | {"id": t.id} for t in todos_snap]
    pending = [t for t in todos if not t.get("completed")]
    completed = [t for t in todos if t.get("completed")]
    stats["pendingTodos"] = len(pending)
    stats["completedTodos"] = len(completed)

    if context_flags.get("todos", True):
        lines.append(f"\n## TASKS & TODOS ({len(todos)} total)")
        if pending:
            lines.append("PENDING:")
            for t in pending:
                lines.append(f"  - [{t.get('assignedTo', '?')}] {t.get('label', 'Unnamed')} (type: {t.get('type', '?')})")
        if completed:
            lines.append(f"COMPLETED ({len(completed)}):")
            for t in completed:
                lines.append(f"  - {t.get('label', 'Unnamed')}")

    # Documents
    docs_snap = db.collection("users").document(client_uid).collection("documents").get()
    docs = [d.to_dict() | {"id": d.id} for d in docs_snap]
    stats["documentCount"] = len(docs)

    if context_flags.get("documents", True):
        lines.append(f"\n## UPLOADED DOCUMENTS ({len(docs)} files)")
        for folder in ["client", "internal", "contractor"]:
            folder_docs = [d for d in docs if d.get("folder") == folder]
            if folder_docs:
                lines.append(f"{folder.upper()} FOLDER:")
                for d in folder_docs:
                    lines.append(f"  - {d.get('name', 'Unnamed')} (uploaded {_ts_str(d.get('uploadedAt'))})")

    # Selections
    sels_snap = db.collection("users").document(client_uid).collection("selections").get()
    sels = [s.to_dict() | {"id": s.id} for s in sels_snap]
    stats["selectionCount"] = len(sels)
    stats["pendingSelections"] = len([s for s in sels if s.get("status") == "needs_approval"])

    if context_flags.get("selections", True):
        lines.append(f"\n## MATERIAL SELECTIONS ({len(sels)} items)")
        icons = {"approved": "✅", "rejected": "❌", "needs_approval": "⏳"}
        for s in sels:
            icon = icons.get(s.get("status", ""), "?")
            lines.append(f"  {icon} {s.get('category', '?')}: {s.get('product', 'N/A')} [{s.get('status', '?')}]")
            if s.get("notes"):
                lines.append(f"      Notes: {s['notes']}")

    # Budget
    budget_snap = db.collection("users").document(client_uid).collection("budget").get()
    budget_items = [b.to_dict() | {"id": b.id} for b in budget_snap]
    budget_total = sum(b.get("total", 0) for b in budget_items)
    stats["budgetTotal"] = budget_total
    stats["budgetItemCount"] = len(budget_items)

    if context_flags.get("budget", True) and budget_items:
        lines.append(f"\n## BUDGET (Total: ${budget_total:,.2f})")
        for b in sorted(budget_items, key=lambda x: x.get("total", 0), reverse=True):
            qty_str = f" x{b.get('qty', 1)} {b.get('unit', '')}" if b.get("priceType") == "per_unit" else ""
            lines.append(f"  - {b.get('label', 'Item')}{qty_str}: ${b.get('total', 0):,.2f}")

    # Activity
    if context_flags.get("activity", True):
        acts_ref = (
            db.collection("users").document(client_uid)
            .collection("activity")
            .order_by("timestamp", direction="DESCENDING")
            .limit(30)
            .stream()
        )
        acts = []
        for a in acts_ref:
            ad = a.to_dict()
            acts.append({
                "type": ad.get("type", "?"),
                "details": ad.get("details", ""),
                "ts": _ts_str(ad.get("timestamp")),
                "actor": ad.get("actor", "?"),
            })
        stats["recentActivityCount"] = len(acts)
        if acts:
            lines.append(f"\n## RECENT ACTIVITY (last {len(acts)} events)")
            for a in acts:
                detail = f" — {a['details']}" if a.get("details") else ""
                lines.append(f"  [{a['ts']}] {a['actor']}: {a['type']}{detail}")

    # CompanyCam photos
    ccam_project_id = ud.get("companyCamProjectId", "")
    photos = []
    stats["hasPhotos"] = bool(ccam_project_id)
    stats["photoCount"] = 0

    if ccam_project_id and context_flags.get("photos", True):
        org_doc = db.collection("organization_data").document(org_id).get()
        ccam_key = org_doc.to_dict().get("companyCamAPI", "") if org_doc.exists else ""
        if ccam_key:
            try:
                resp = requests.get(
                    f"https://api.companycam.com/v2/projects/{ccam_project_id}/photos",
                    headers={"Authorization": f"Bearer {ccam_key}"},
                    params={"per_page": 50},
                    timeout=10,
                )
                if resp.ok:
                    raw = resp.json()
                    stats["photoCount"] = len(raw)
                    client_summary["photoCount"] = len(raw)
                    for ph in raw:
                        uris = ph.get("uris", [])
                        medium = next((u["uri"] for u in uris if u.get("type") == "medium"), None)
                        thumb = next((u["uri"] for u in uris if u.get("type") == "thumb"), None)
                        if medium or thumb:
                            photos.append({"id": ph.get("id"), "thumbUrl": thumb or medium, "mediumUrl": medium or thumb})
                    if photos:
                        lines.append(f"\n## COMPANYCAM PHOTOS")
                        lines.append(f"Total photos on file: {stats['photoCount']}")
                        lines.append("(Photo thumbnails will be provided as images in this conversation)")
            except Exception as e:
                print(f"[ai/context] CompanyCam error: {e}")

    context_string = "\n".join(lines)
    return context_string, client_summary, photos, stats


# ── Routes ────────────────────────────────────────────────────────────────────

@ai_analysis_app.route("/context", methods=["POST"])
def get_context():
    caller_uid, err = _require_auth()
    if err:
        return err

    data = request.json or {}
    org_id = data.get("orgId", "")
    client_uid = data.get("clientUid", "")
    context_flags = data.get("contextFlags", {})

    if not org_id or not client_uid:
        return jsonify({"error": "orgId and clientUid are required"}), 400

    client_name_hint = data.get("clientName", "")
    db = admin_firestore.client()
    context_string, client_summary, photos, stats = _build_context(
        db, org_id, client_uid, context_flags, client_name_hint
    )

    if context_string is None:
        return jsonify({"error": "Client not found"}), 404

    # ── Store context in Firestore cache ─────────────────────────────
    cache_key = f"{org_id}_{client_uid}_{_flags_hash(context_flags)}"
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=CACHE_TTL_MINUTES)).isoformat()

    db.collection("ai_context_cache").document(cache_key).set({
        "contextString": context_string,
        "photoUrls": [p.get("mediumUrl") or p.get("thumbUrl") for p in photos[:15]],
        "orgId": org_id,
        "clientUid": client_uid,
        "callerUid": caller_uid,
        "expiresAt": expires_at,
        "createdAt": admin_firestore.SERVER_TIMESTAMP,
    })

    # contextString is NOT returned to the client — only the cache key
    return jsonify({
        "cacheKey": cache_key,
        "clientSummary": client_summary,
        "photos": photos[:30],  # thumb URLs for sidebar preview only
        "stats": stats,
        "expiresAt": expires_at,
    })


@ai_analysis_app.route("/chat", methods=["POST"])
def chat():
    caller_uid, err = _require_auth()
    if err:
        return err

    data = request.json or {}
    messages = data.get("messages", [])
    cache_key = data.get("cacheKey", "")
    include_photos = data.get("includePhotos", False)
    model = data.get("model", CLAUDE_MODEL)
    if model not in ALLOWED_MODELS:
        model = CLAUDE_MODEL

    if not messages:
        return jsonify({"error": "messages required"}), 400
    if not cache_key:
        return jsonify({"error": "cacheKey required — load context first"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured on server"}), 500

    # ── Resolve context from Firestore cache ─────────────────────────
    db = admin_firestore.client()
    cache_doc = db.collection("ai_context_cache").document(cache_key).get()

    if not cache_doc.exists:
        return jsonify({"error": "context_expired"}), 400

    cache_data = cache_doc.to_dict()

    # Verify the caller owns this cache entry
    if cache_data.get("callerUid") != caller_uid:
        return jsonify({"error": "Unauthorized"}), 403

    expires_at_str = cache_data.get("expiresAt", "")
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > expires_at:
                return jsonify({"error": "context_expired"}), 400
        except ValueError:
            pass  # Malformed date — proceed anyway

    context_string = cache_data.get("contextString", "")
    photo_urls = cache_data.get("photoUrls", []) if include_photos else []

    # ── Build Claude messages with prompt caching ────────────────────
    claude_messages = []
    for i, msg in enumerate(messages):
        if i == 0 and msg.get("role") == "user":
            user_text = msg.get("content", "")
            # context block marked for caching — Claude will cache this prefix
            content = [
                {
                    "type": "text",
                    "text": f"<case_file>\n{context_string}\n</case_file>\n\n{user_text}",
                    "cache_control": {"type": "ephemeral"},
                }
            ]
            # Attach photos after the cached text block
            if photo_urls:
                fetched = 0
                for url in photo_urls[:15]:
                    try:
                        r = requests.get(url, timeout=8)
                        if r.ok:
                            media = r.headers.get("content-type", "image/jpeg").split(";")[0]
                            content.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media,
                                    "data": base64.standard_b64encode(r.content).decode("utf-8"),
                                },
                            })
                            fetched += 1
                    except Exception as e:
                        print(f"[ai/chat] photo fetch failed: {e}")
                print(f"[ai/chat] attached {fetched} photos from cache")

            claude_messages.append({"role": "user", "content": content})
        else:
            claude_messages.append(msg)

    client = anthropic.Anthropic(api_key=api_key)

    def generate():
        try:
            with client.messages.stream(
                model=model,
                max_tokens=4096,
                # System prompt cached as a separate prefix
                system=[{
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }],
                messages=claude_messages,
                extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.APIError as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'Unexpected error: {e}'})}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
