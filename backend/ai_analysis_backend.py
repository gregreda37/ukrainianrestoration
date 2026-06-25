import os
import json
import base64
import requests
import anthropic
from flask import Blueprint, request, jsonify, Response, stream_with_context
from firebase_admin import firestore as admin_firestore

ai_analysis_app = Blueprint("ai_analysis_app", __name__)

CLAUDE_MODEL = "claude-sonnet-4-6"

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


def _ts_str(ts):
    if ts is None:
        return "N/A"
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d %H:%M")
    return str(ts)


def _build_context_string(db, org_id, client_uid, context_flags):
    lines = []
    stats = {}

    # ── Client profile ──────────────────────────────────────────────
    user_doc = db.collection("users").document(client_uid).get()
    if not user_doc.exists:
        return None, None, []

    ud = user_doc.to_dict()
    mit_step = ud.get("mitigationStep", -1)
    con_step = ud.get("constructionStep", -1)
    adj = ud.get("adjuster") or {}

    client_summary = {
        "name": ud.get("displayName", "Unknown"),
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
    lines.append(f"Name: {ud.get('displayName', 'N/A')}")
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

    # ── Todos ────────────────────────────────────────────────────────
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

    # ── Documents ────────────────────────────────────────────────────
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
                    ts = _ts_str(d.get("uploadedAt"))
                    lines.append(f"  - {d.get('name', 'Unnamed')} (uploaded {ts})")

    # ── Selections ───────────────────────────────────────────────────
    sels_snap = db.collection("users").document(client_uid).collection("selections").get()
    sels = [s.to_dict() | {"id": s.id} for s in sels_snap]
    stats["selectionCount"] = len(sels)
    pending_sels = [s for s in sels if s.get("status") == "needs_approval"]
    stats["pendingSelections"] = len(pending_sels)

    if context_flags.get("selections", True):
        lines.append(f"\n## MATERIAL SELECTIONS ({len(sels)} items)")
        status_icon = {"approved": "✅", "rejected": "❌", "needs_approval": "⏳"}
        for s in sels:
            icon = status_icon.get(s.get("status", ""), "?")
            lines.append(f"  {icon} {s.get('category', '?')}: {s.get('product', 'N/A')} [{s.get('status', '?')}]")
            if s.get("notes"):
                lines.append(f"      Notes: {s['notes']}")
            if s.get("url"):
                lines.append(f"      Link: {s['url']}")

    # ── Budget ───────────────────────────────────────────────────────
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

    # ── Activity ─────────────────────────────────────────────────────
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

    # ── CompanyCam photos ────────────────────────────────────────────
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
                            photos.append({
                                "id": ph.get("id"),
                                "thumbUrl": thumb or medium,
                                "mediumUrl": medium or thumb,
                            })
                    if photos:
                        lines.append(f"\n## COMPANYCAM PHOTOS")
                        lines.append(f"Total photos on file: {stats['photoCount']}")
                        lines.append("(Photo thumbnails will be provided as images in this conversation)")
            except Exception as e:
                print(f"[ai/context] CompanyCam fetch error: {e}")

    context_string = "\n".join(lines)
    return context_string, client_summary, photos, stats


@ai_analysis_app.route("/context", methods=["POST"])
def get_context():
    data = request.json or {}
    org_id = data.get("orgId", "")
    client_uid = data.get("clientUid", "")
    context_flags = data.get("contextFlags", {})

    if not org_id or not client_uid:
        return jsonify({"error": "orgId and clientUid are required"}), 400

    db = admin_firestore.client()

    result = _build_context_string(db, org_id, client_uid, context_flags)
    if result[0] is None:
        return jsonify({"error": "Client not found"}), 404

    context_string, client_summary, photos, stats = result

    return jsonify({
        "contextString": context_string,
        "clientSummary": client_summary,
        "photos": photos[:30],
        "stats": stats,
    })


@ai_analysis_app.route("/chat", methods=["POST"])
def chat():
    data = request.json or {}
    messages = data.get("messages", [])
    context_string = data.get("contextString", "")
    include_photos = data.get("includePhotos", False)
    photo_urls = data.get("photoUrls", [])

    if not messages:
        return jsonify({"error": "messages required"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured on server"}), 500

    client = anthropic.Anthropic(api_key=api_key)

    # Build Claude message array — inject context into first user message
    claude_messages = []
    for i, msg in enumerate(messages):
        if i == 0 and msg.get("role") == "user":
            user_text = msg.get("content", "")
            context_block = f"<case_file>\n{context_string}\n</case_file>\n\n" if context_string else ""
            content = [{"type": "text", "text": context_block + user_text}]

            # Attach photos to first message if requested
            if include_photos and photo_urls:
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
                print(f"[ai/chat] attached {fetched} photos")

            claude_messages.append({"role": "user", "content": content})
        else:
            claude_messages.append(msg)

    def generate():
        try:
            with client.messages.stream(
                model=CLAUDE_MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=claude_messages,
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
