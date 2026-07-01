import io
import os
import re
import json
import base64
import hashlib
import requests
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed, wait as _fut_wait, FIRST_COMPLETED
import anthropic
from datetime import datetime, timezone, timedelta
from flask import Blueprint, request, jsonify, Response, stream_with_context
from firebase_admin import firestore as admin_firestore, auth as admin_auth

ai_analysis_app = Blueprint("ai_analysis_app", __name__)

CLAUDE_MODEL      = "claude-haiku-4-5-20251001"
ALLOWED_MODELS    = {"claude-haiku-4-5-20251001", "claude-sonnet-4-6"}
CACHE_TTL_MINUTES = 30
CACHE_VERSION     = "v2"  # bump to invalidate all cached contexts on deploy

# ── Image pipeline constants ──────────────────────────────────────────────────
# CompanyCam URI priority: original can be huge (>10 MB); large ~1-3 MB is ideal.
CCAM_URI_PRIORITY = ["large", "original", "medium", "thumb"]
IMAGE_MAX_DIM   = 1024   # px — Claude reads fine at 1024; larger wastes tokens
JPEG_QUALITY    = 82     # output quality after resize
MAX_PHOTOS_LLM  = 20     # max images actually sent to Claude per request
BLUR_THRESHOLD  = 80.0   # Laplacian variance below this → reject as blurry/out-of-focus
DEDUP_BITS      = 8      # perceptual hash bit-distance threshold for near-duplicates
FETCH_TIMEOUT   = 15     # seconds per image
FETCH_WORKERS   = 8      # parallel fetches
MAX_RAW_BYTES   = 10 * 1024 * 1024  # 10 MB per image cap

PHOTO_CATEGORIES = [
    "Worker",
    "Equipment",        # dehumidifiers, air movers, fans, blowers
    "Moisture Reading", # moisture meters, gauges, thermal imaging
    "Demolition",       # removed drywall, gutted walls, tear-out
    "Water Damage",     # visible staining, flooding, wet materials
    "Mold",             # mold, mildew, microbial growth
    "Contents",         # furniture, belongings, personal items
    "Structural",       # framing, joists, foundation
    "Documentation",    # scope sheets, labels, paperwork
    "Before",           # before remediation work
    "After",            # after work completed
    "Other",
]

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
- Analyze property damage from photos when available — be specific about damage types, scope, and location
- Help the contractor prioritize next steps and flag urgencies
- Generate clear summaries and client-ready reports when asked
- Flag concerns about timeline, budget discrepancies, or claim status

Always cite specific numbers, names, and dates from the case file. Be direct and actionable."""


# ── Auth ──────────────────────────────────────────────────────────────────────

def _require_auth():
    body  = request.get_json(silent=True) or {}
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


def _best_ccam_url(uris: list) -> tuple[str | None, str | None]:
    """
    Return (full_url, thumb_url) from a CompanyCam photo's `uris` array.
    full_url uses the highest-quality URI available for the LLM.
    thumb_url is always the smallest for sidebar preview.
    """
    uri_map = {u.get("type"): u.get("uri") for u in uris if u.get("type") and u.get("uri")}
    full_url = next((uri_map[t] for t in CCAM_URI_PRIORITY if t in uri_map), None)
    thumb_url = uri_map.get("thumb") or uri_map.get("medium") or full_url
    return full_url, thumb_url


# ── Image preprocessing pipeline ─────────────────────────────────────────────

def _compute_blur_score(img: Image.Image) -> float:
    """
    Laplacian variance as a sharpness measure.
    Uses fast numpy approximation: var of second-order pixel differences.
    Higher = sharper. Returns 0.0 on failure.
    """
    try:
        gray = np.array(img.convert("L"), dtype=np.float32)
        # Discrete Laplacian kernel: center=4, neighbours=-1
        lap = (
            4 * gray
            - np.roll(gray,  1, axis=0)
            - np.roll(gray, -1, axis=0)
            - np.roll(gray,  1, axis=1)
            - np.roll(gray, -1, axis=1)
        )
        return float(np.var(lap))
    except Exception:
        return 0.0


def _compute_phash(img: Image.Image) -> int:
    """
    64-bit perceptual hash (dHash variant).
    Returns an integer; compare two hashes with bin(a ^ b).count('1') < DEDUP_BITS.
    """
    try:
        # Resize to 9×8, compute horizontal differences → 64 bits
        small = img.convert("L").resize((9, 8), Image.LANCZOS)
        pixels = list(small.getdata())
        bits = 0
        for row in range(8):
            for col in range(8):
                idx = row * 9 + col
                if pixels[idx] > pixels[idx + 1]:
                    bits |= 1 << (row * 8 + col)
        return bits
    except Exception:
        return 0


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _fetch_and_process(url: str) -> dict | None:
    """
    Fetch one CompanyCam image URL, quality-check it, and resize for Claude.
    Returns a dict with the Claude image block plus metadata, or None to skip.
    """
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, stream=True)
        if not resp.ok:
            print(f"[ai/img] HTTP {resp.status_code} for {url[:80]}")
            return None

        # Stream into memory with a size cap
        chunks, total = [], 0
        for chunk in resp.iter_content(chunk_size=65_536):
            total += len(chunk)
            if total > MAX_RAW_BYTES:
                print(f"[ai/img] image too large (>{MAX_RAW_BYTES // 1_048_576} MB), skipping")
                return None
            chunks.append(chunk)
        raw = b"".join(chunks)
        if not raw:
            return None

        img = Image.open(io.BytesIO(raw))
        if img.mode not in ("RGB", "RGBA", "L"):
            img = img.convert("RGB")
        elif img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode == "L":
            img = img.convert("RGB")

        blur = _compute_blur_score(img)
        phash = _compute_phash(img)

        if blur < BLUR_THRESHOLD:
            print(f"[ai/img] blur={blur:.1f} < {BLUR_THRESHOLD} → skipped")
            return None

        # Resize to Claude's sweet spot — 1024px max side
        w, h = img.size
        if max(w, h) > IMAGE_MAX_DIM:
            scale = IMAGE_MAX_DIM / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        data = base64.standard_b64encode(buf.getvalue()).decode()

        return {
            "block": {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
            },
            "blur": blur,
            "phash": phash,
            "bytes": len(buf.getvalue()),
        }
    except Exception as e:
        print(f"[ai/img] process error: {e}")
        return None


def _select_best_photos(photo_infos: list[dict], max_count: int = MAX_PHOTOS_LLM) -> list[dict]:
    """
    Given a list of photo dicts (each with fullUrl + thumbUrl + capturedAt):
    1. Fetch + quality-score in parallel
    2. Deduplicate near-identical shots
    3. Return the best `max_count` results (each includes block, blur, url, thumbUrl).
    """
    entries = [
        (p["fullUrl"], p.get("thumbUrl") or p["fullUrl"])
        for p in photo_infos if p.get("fullUrl")
    ]
    if not entries:
        return []

    raw_results: list[dict | None] = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        future_to_idx = {pool.submit(_fetch_and_process, url): i for i, (url, _) in enumerate(entries)}
        for future in as_completed(future_to_idx):
            i = future_to_idx[future]
            result = future.result()
            if result is not None:
                result["url"]      = entries[i][0]
                result["thumbUrl"] = entries[i][1]
            raw_results[i] = result

    good = [r for r in raw_results if r is not None]

    kept: list[dict] = []
    for candidate in sorted(good, key=lambda x: x["blur"], reverse=True):
        duplicate = any(_hamming(candidate["phash"], k["phash"]) < DEDUP_BITS for k in kept)
        if not duplicate:
            kept.append(candidate)
        if len(kept) >= max_count:
            break

    total_kb = sum(r["bytes"] for r in kept) // 1024
    print(
        f"[ai/img] {len(entries)} fetched → {len(good)} passed blur "
        f"→ {len(kept)} after dedup (≤{max_count}) "
        f"— {total_kb} KB total"
    )
    return kept


def _process_and_cache_photos(db, cache_key: str, photo_infos: list[dict],
                               caller_uid: str, expires_at: str,
                               client_uid: str = "") -> int:
    """
    Pre-process CompanyCam photos during /context so /chat never does inline
    image fetching. Stores image blocks in ai_photo_blocks/{cache_key} to keep
    the main cache document under Firestore's 1 MB limit.
    Returns the number of photos successfully processed and cached.
    """
    try:
        selected = _select_best_photos(photo_infos, MAX_PHOTOS_LLM)
        image_blocks = [r["block"] for r in selected]
        photo_meta   = [{"url": r.get("url", ""), "thumbUrl": r.get("thumbUrl", r.get("url", ""))} for r in selected]
        db.collection("ai_photo_blocks").document(cache_key).set({
            "imageBlocks":    image_blocks,
            "photoMeta":      photo_meta,
            "processedCount": len(image_blocks),
            "callerUid":      caller_uid,
            "clientUid":      client_uid,
            "expiresAt":      expires_at,
            "processedAt":    admin_firestore.SERVER_TIMESTAMP,
        })
        print(f"[ai/photos] cached {len(image_blocks)} photo blocks for {cache_key}")
        return len(image_blocks)
    except Exception as e:
        print(f"[ai/photos] caching failed for {cache_key}: {e}")
        return 0


# ── Context builder ───────────────────────────────────────────────────────────

def _build_context(db, org_id, client_uid, context_flags, client_name_hint=""):
    """
    Build context string + supporting data from Firestore.
    Subcollection reads (todos, documents, selections, budget, activity) run in
    parallel via ThreadPoolExecutor — one Firestore round-trip instead of five.
    """
    lines = []
    stats = {}

    # Serial: user doc must come first (everything else depends on it)
    user_doc = db.collection("users").document(client_uid).get()
    if not user_doc.exists:
        return None, None, [], {}

    ud           = user_doc.to_dict()
    mit_step     = ud.get("mitigationStep", -1)
    con_step     = ud.get("constructionStep", -1)
    adj          = ud.get("adjuster") or {}
    display_name = ud.get("displayName") or client_name_hint or "Unknown"

    client_summary = {
        "name":                 display_name,
        "email":                ud.get("email", ""),
        "phone":                ud.get("phoneNumber", ""),
        "address":              ud.get("address", ""),
        "claimNumbers":         ud.get("claimNumbers", []),
        "policyNumber":         ud.get("policyNumber", ""),
        "mitigationStep":       mit_step,
        "constructionStep":     con_step,
        "adjuster":             adj,
        "companyCamProjectId":  ud.get("companyCamProjectId", ""),
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

    # Parallel subcollection reads — all fire simultaneously
    user_ref = db.collection("users").document(client_uid)

    def _fetch_todos():
        return list(user_ref.collection("todos").get())

    def _fetch_docs():
        return list(user_ref.collection("documents").get())

    def _fetch_sels():
        return list(user_ref.collection("selections").get())

    def _fetch_budget():
        return list(user_ref.collection("budget").get())

    def _fetch_activity():
        if not context_flags.get("activity", True):
            return []
        return list(
            user_ref.collection("activity")
            .order_by("timestamp", direction="DESCENDING")
            .limit(30)
            .stream()
        )

    with ThreadPoolExecutor(max_workers=5) as pool:
        f_todos, f_docs, f_sels, f_budget, f_activity = (
            pool.submit(_fetch_todos),
            pool.submit(_fetch_docs),
            pool.submit(_fetch_sels),
            pool.submit(_fetch_budget),
            pool.submit(_fetch_activity),
        )
        todos_snaps    = f_todos.result()
        docs_snaps     = f_docs.result()
        sels_snaps     = f_sels.result()
        budget_snaps   = f_budget.result()
        activity_snaps = f_activity.result()

    # Todos
    todos     = [t.to_dict() | {"id": t.id} for t in todos_snaps]
    pending   = [t for t in todos if not t.get("completed")]
    completed = [t for t in todos if t.get("completed")]
    stats["pendingTodos"]   = len(pending)
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
    docs = [d.to_dict() | {"id": d.id} for d in docs_snaps]
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
    sels = [s.to_dict() | {"id": s.id} for s in sels_snaps]
    stats["selectionCount"]    = len(sels)
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
    budget_items = [b.to_dict() | {"id": b.id} for b in budget_snaps]
    budget_total = sum(b.get("total", 0) for b in budget_items)
    stats["budgetTotal"]     = budget_total
    stats["budgetItemCount"] = len(budget_items)

    if context_flags.get("budget", True) and budget_items:
        lines.append(f"\n## BUDGET (Total: ${budget_total:,.2f})")
        for b in sorted(budget_items, key=lambda x: x.get("total", 0), reverse=True):
            qty_str = f" x{b.get('qty', 1)} {b.get('unit', '')}" if b.get("priceType") == "per_unit" else ""
            lines.append(f"  - {b.get('label', 'Item')}{qty_str}: ${b.get('total', 0):,.2f}")

    # Activity
    acts = []
    for a in activity_snaps:
        ad = a.to_dict()
        acts.append({
            "type":    ad.get("type", "?"),
            "details": ad.get("details", ""),
            "ts":      _ts_str(ad.get("timestamp")),
            "actor":   ad.get("actor", "?"),
        })
    stats["recentActivityCount"] = len(acts)
    if acts and context_flags.get("activity", True):
        lines.append(f"\n## RECENT ACTIVITY (last {len(acts)} events)")
        for a in acts:
            detail = f" — {a['details']}" if a.get("details") else ""
            lines.append(f"  [{a['ts']}] {a['actor']}: {a['type']}{detail}")

    # CompanyCam presence (no API call here — photos handled by /classify-photos)
    ccam_project_id    = ud.get("companyCamProjectId", "")
    photos: list[dict] = []
    stats["hasPhotos"]  = bool(ccam_project_id)
    stats["photoCount"] = 0

    context_string = "\n".join(lines)
    return context_string, client_summary, photos, stats


# ── Routes ────────────────────────────────────────────────────────────────────

@ai_analysis_app.route("/context", methods=["POST"])
def get_context():
    caller_uid, err = _require_auth()
    if err:
        return err

    data           = request.json or {}
    org_id         = data.get("orgId", "")
    client_uid     = data.get("clientUid", "")
    context_flags  = data.get("contextFlags", {})
    client_name_hint = data.get("clientName", "")

    if not org_id or not client_uid:
        return jsonify({"error": "orgId and clientUid are required"}), 400

    try:
        db        = admin_firestore.client()
        cache_key = f"{CACHE_VERSION}_{org_id}_{client_uid}_{_flags_hash(context_flags)}"

        # Fast path: return cached context if still fresh and same caller
        cached = db.collection("ai_context_cache").document(cache_key).get()
        if cached.exists:
            cd = cached.to_dict()
            if cd.get("callerUid") == caller_uid:
                exp = cd.get("expiresAt", "")
                try:
                    if exp and datetime.now(timezone.utc) < datetime.fromisoformat(exp):
                        print(f"[ai/context] cache hit for {cache_key}")
                        return jsonify({
                            "cacheKey":      cache_key,
                            "clientSummary": cd.get("clientSummary"),
                            "stats":         cd.get("stats"),
                            "expiresAt":     exp,
                        })
                except ValueError:
                    pass

        # Cache miss — build from Firestore (subcollections read in parallel)
        context_string, client_summary, photos, stats = _build_context(
            db, org_id, client_uid, context_flags, client_name_hint
        )

        if context_string is None:
            return jsonify({"error": "Client not found"}), 404

        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=CACHE_TTL_MINUTES)).isoformat()

        db.collection("ai_context_cache").document(cache_key).set({
            "contextString": context_string,
            "clientSummary": client_summary,
            "stats":         stats,
            "orgId":         org_id,
            "clientUid":     client_uid,
            "callerUid":     caller_uid,
            "expiresAt":     expires_at,
            "createdAt":     admin_firestore.SERVER_TIMESTAMP,
        })

        return jsonify({
            "cacheKey":      cache_key,
            "clientSummary": client_summary,
            "stats":         stats,
            "expiresAt":     expires_at,
        })
    except Exception as e:
        print(f"[ai/context] unhandled error: {e}")
        return jsonify({"error": f"Context build failed: {str(e)}"}), 500


@ai_analysis_app.route("/classify-photos", methods=["POST"])
def classify_photos():
    caller_uid, err = _require_auth()
    if err:
        return err

    data       = request.json or {}
    cache_key  = data.get("cacheKey", "")
    org_id     = data.get("orgId", "")
    client_uid = data.get("clientUid", "")

    if not cache_key or not org_id or not client_uid:
        return jsonify({"error": "cacheKey, orgId, and clientUid required"}), 400

    try:
        db = admin_firestore.client()

        # Verify the text context cache belongs to this caller
        cache_doc = db.collection("ai_context_cache").document(cache_key).get()
        if not cache_doc.exists or cache_doc.to_dict().get("callerUid") != caller_uid:
            return jsonify({"error": "Invalid or expired context — reload context first"}), 400

        # Return cached classification if fresh (< 1 hour old and same photo count)
        cls_ref = db.collection("ai_photo_classifications").document(cache_key)
        cls_doc = cls_ref.get()
        if cls_doc.exists:
            cls = cls_doc.to_dict()
            if cls.get("callerUid") == caller_uid:
                classified_at = cls.get("classifiedAt")
                if classified_at:
                    age_s = (datetime.now(timezone.utc) - classified_at).total_seconds()
                    pb_check = db.collection("ai_photo_blocks").document(cache_key).get()
                    cached_count = pb_check.to_dict().get("processedCount", 0) if pb_check.exists else 0
                    if age_s < 3600 and cls.get("photoCount", 0) == cached_count and cached_count > 0:
                        return jsonify({
                            "categories": cls.get("categories", {}),
                            "total":      cls.get("photoCount", 0),
                            "cached":     True,
                        })

        # Fetch client's CompanyCam project
        user_doc = db.collection("users").document(client_uid).get()
        if not user_doc.exists:
            return jsonify({"error": "Client not found"}), 404
        ud = user_doc.to_dict()
        cc_project_id = ud.get("companyCamProjectId", "")
        if not cc_project_id:
            return jsonify({"error": "No CompanyCam project linked to this client"}), 404

        org_doc = db.collection("organization_data").document(org_id).get()
        cc_key  = org_doc.to_dict().get("companyCamAPI", "") if org_doc.exists else ""
        if not cc_key:
            return jsonify({"error": "No CompanyCam API key configured"}), 404

        # Fetch all photos from CompanyCam
        all_raw: list[dict] = []
        page = 1
        while True:
            resp = requests.get(
                f"https://api.companycam.com/v2/projects/{cc_project_id}/photos",
                headers={"Authorization": f"Bearer {cc_key}"},
                params={"per_page": 50, "page": page},
                timeout=15,
            )
            if not resp.ok:
                return jsonify({"error": f"CompanyCam API error {resp.status_code}"}), 502
            batch = resp.json()
            if isinstance(batch, dict):
                batch = batch.get("data", [])
            all_raw.extend(batch)
            if len(batch) < 50:
                break
            page += 1

        photo_infos: list[dict] = []
        for ph in all_raw:
            full_url, thumb_url = _best_ccam_url(ph.get("uris", []))
            if full_url:
                photo_infos.append({
                    "id":         ph.get("id"),
                    "fullUrl":    full_url,
                    "thumbUrl":   thumb_url,
                    "capturedAt": ph.get("captured_at"),
                })

        if not photo_infos:
            return jsonify({"categories": {}, "total": 0}), 200

        # Process photos (resize, blur-filter, dedup) → stored in ai_photo_blocks
        expires_at = cache_doc.to_dict().get("expiresAt",
            (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat())
        n = _process_and_cache_photos(db, cache_key, photo_infos, caller_uid, expires_at, client_uid)
        if n == 0:
            return jsonify({"error": "Photo processing failed — no usable images"}), 500

        pb_data      = db.collection("ai_photo_blocks").document(cache_key).get().to_dict()
        image_blocks = pb_data.get("imageBlocks", [])
        photo_meta   = pb_data.get("photoMeta", [])

        # Classify with Claude Haiku in batches of 20
        api_key      = os.environ.get("ANTHROPIC_API_KEY", "")
        claude_client = anthropic.Anthropic(api_key=api_key)
        classifications: dict[int, str] = {}
        cats_str = ", ".join(PHOTO_CATEGORIES)
        BATCH = 20

        for batch_start in range(0, len(image_blocks), BATCH):
            batch_blocks = image_blocks[batch_start:batch_start + BATCH]
            content: list[dict] = []
            for i, blk in enumerate(batch_blocks):
                content.append(blk)
                content.append({"type": "text", "text": f"[Photo #{batch_start + i}]"})
            content.append({
                "type": "text",
                "text": (
                    f"Classify each numbered photo for a water damage restoration company. "
                    f"Assign ONE category from: {cats_str}.\n\n"
                    f"Return ONLY a JSON array, no other text:\n"
                    f'[{{"idx": 0, "category": "Water Damage"}}, ...]'
                ),
            })
            resp = claude_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                messages=[{"role": "user", "content": content}],
            )
            raw_text = resp.content[0].text.strip()
            match = re.search(r'\[.*?\]', raw_text, re.DOTALL)
            if match:
                try:
                    for item in json.loads(match.group()):
                        idx = item.get("idx")
                        cat = item.get("category", "Other")
                        if isinstance(idx, int):
                            classifications[idx] = cat if cat in PHOTO_CATEGORIES else "Other"
                except Exception as parse_err:
                    print(f"[ai/classify-photos] parse error: {parse_err}")

        # Build per-category lists
        categories: dict[str, list] = {}
        for i in range(len(image_blocks)):
            cat  = classifications.get(i, "Other")
            meta = photo_meta[i] if i < len(photo_meta) else {}
            if cat not in categories:
                categories[cat] = []
            categories[cat].append({
                "idx":      i,
                "url":      meta.get("url", ""),
                "thumbUrl": meta.get("thumbUrl", meta.get("url", "")),
            })

        # Persist classifications
        cls_ref.set({
            "callerUid":    caller_uid,
            "clientUid":    client_uid,
            "orgId":        org_id,
            "classifiedAt": admin_firestore.SERVER_TIMESTAMP,
            "photoCount":   len(image_blocks),
            "categories":   categories,
        })
        print(f"[ai/classify-photos] classified {len(image_blocks)} photos into {len(categories)} categories for {cache_key}")

        return jsonify({"categories": categories, "total": len(image_blocks)})

    except Exception as e:
        print(f"[ai/classify-photos] unhandled error: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@ai_analysis_app.route("/chat", methods=["POST"])
def chat():
    caller_uid, err = _require_auth()
    if err:
        return err

    data           = request.json or {}
    messages       = data.get("messages", [])
    cache_key      = data.get("cacheKey", "")
    photo_category = data.get("photoCategory", "")
    model          = data.get("model", CLAUDE_MODEL)
    if model not in ALLOWED_MODELS:
        model = CLAUDE_MODEL

    if not messages:
        return jsonify({"error": "messages required"}), 400
    if not cache_key:
        return jsonify({"error": "cacheKey required — load context first"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured on server"}), 500

    # ── Resolve context from Firestore cache ──────────────────────────────────
    db        = admin_firestore.client()
    cache_doc = db.collection("ai_context_cache").document(cache_key).get()

    if not cache_doc.exists:
        return jsonify({"error": "context_expired"}), 400

    cache_data = cache_doc.to_dict()

    if cache_data.get("callerUid") != caller_uid:
        return jsonify({"error": "Unauthorized"}), 403

    expires_at_str = cache_data.get("expiresAt", "")
    if expires_at_str:
        try:
            if datetime.now(timezone.utc) > datetime.fromisoformat(expires_at_str):
                return jsonify({"error": "context_expired"}), 400
        except ValueError:
            pass

    context_string = cache_data.get("contextString", "")

    # ── Load pre-processed photo blocks ──────────────────────────────────────
    image_blocks: list[dict] = []
    if photo_category:
        try:
            pb_doc = db.collection("ai_photo_blocks").document(cache_key).get()
            if pb_doc.exists and pb_doc.to_dict().get("callerUid") == caller_uid:
                all_blocks = pb_doc.to_dict().get("imageBlocks", [])
                if photo_category == "__all__":
                    image_blocks = all_blocks
                    print(f"[ai/chat] using all {len(image_blocks)} photos")
                else:
                    cls_doc = db.collection("ai_photo_classifications").document(cache_key).get()
                    if cls_doc.exists and cls_doc.to_dict().get("callerUid") == caller_uid:
                        cat_photos = cls_doc.to_dict().get("categories", {}).get(photo_category, [])
                        indices = {p["idx"] for p in cat_photos}
                        image_blocks = [b for i, b in enumerate(all_blocks) if i in indices]
                        print(f"[ai/chat] filtered to {len(image_blocks)} '{photo_category}' photos")
                    else:
                        image_blocks = all_blocks
                        print(f"[ai/chat] no classification found — using all {len(all_blocks)} photos")
            else:
                print("[ai/chat] no pre-cached photo blocks found — proceeding without")
        except Exception as e:
            print(f"[ai/chat] photo load failed: {e} — proceeding without")

    # ── Build Claude messages ─────────────────────────────────────────────────
    claude_messages: list[dict] = []
    for i, msg in enumerate(messages):
        if i == 0 and msg.get("role") == "user":
            user_text = msg.get("content", "")
            content = [
                {
                    "type": "text",
                    "text": f"<case_file>\n{context_string}\n</case_file>\n\n{user_text}",
                    "cache_control": {"type": "ephemeral"},
                }
            ]
            if photo_category and image_blocks:
                content[0]["text"] += f"\n\n[Note: Only {photo_category} photos are attached for this response.]"
            # Append preprocessed image blocks (already quality-filtered + resized)
            content.extend(image_blocks)
            claude_messages.append({"role": "user", "content": content})
        else:
            claude_messages.append(msg)

    claude_client = anthropic.Anthropic(api_key=api_key)

    def generate():
        try:
            with claude_client.messages.stream(
                model=model,
                max_tokens=4096,
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
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )
