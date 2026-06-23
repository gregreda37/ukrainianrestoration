from flask import request, jsonify, Blueprint
import os
import openai
import time
import io
import base64
import requests as http_requests
import pdfplumber
from firebase_admin import firestore
from dotenv import load_dotenv

load_dotenv()

openai.api_type    = os.getenv("AZURE_OPENAI_API_TYPE", "azure")
openai.api_base    = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_version = os.getenv("AZURE_OPENAI_API_VERSION")
openai.api_key     = os.getenv("AZURE_OPENAI_API_KEY")

DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-35-turbo")

claim_chatbot_app = Blueprint("claim-chatbot", __name__)

MAX_CACHE_CHARS = 800_000


def extract_text_from_bytes(content_bytes, filename):
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            text = ""
            with pdfplumber.open(io.BytesIO(content_bytes)) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
            return text
        except Exception as e:
            print(f"PDF extraction error for {filename}: {e}")
            return ""
    if name.endswith((".txt", ".csv")):
        try:
            return content_bytes.decode("utf-8", errors="ignore")
        except Exception:
            return ""
    return ""


@claim_chatbot_app.route("/process-document", methods=["POST"])
def process_document():
    try:
        user_id = request.json.get("uid")
        doc_id = request.json.get("docId")
        download_url = request.json.get("fileUrl")
        filename = request.json.get("filename", "")

        if not user_id or not doc_id:
            return jsonify({"error": "uid and docId are required"}), 400

        db = firestore.client()
        cache_ref = (
            db.collection("users")
            .document(user_id)
            .collection("document_cache")
            .document(doc_id)
        )

        if cache_ref.get().exists:
            return jsonify({"status": "already_cached"})

        if not download_url:
            return jsonify({"error": "fileUrl is required for uncached documents"}), 400

        resp = http_requests.get(download_url, timeout=15)
        if resp.status_code != 200:
            return jsonify({"error": f"Download failed: HTTP {resp.status_code}"}), 500

        text = extract_text_from_bytes(resp.content, filename)
        if len(text) > MAX_CACHE_CHARS:
            text = text[:MAX_CACHE_CHARS]

        cache_ref.set({
            "filename": filename,
            "extractedText": text,
            "processedAt": time.time(),
        })

        return jsonify({"status": "cached"})

    except Exception as e:
        print(f"Process document error: {e}")
        return jsonify({"error": str(e)}), 500


SELECTION_CATEGORIES = ["Roofing", "Siding", "Windows", "Flooring",
                         "Cabinets", "Countertops", "Fixtures", "Paint", "Other"]

@claim_chatbot_app.route("/extract-selections", methods=["POST"])
def extract_selections():
    import json as _json
    try:
        data         = request.json or {}
        download_url = data.get("fileUrl", "").strip()
        filename     = data.get("filename", "document")

        if not download_url:
            return jsonify({"error": "fileUrl is required"}), 400

        resp = http_requests.get(download_url, timeout=15)
        if resp.status_code != 200:
            return jsonify({"error": f"Could not download document: HTTP {resp.status_code}"}), 500

        text = extract_text_from_bytes(resp.content, filename)
        print(f"[extract-selections] Extracted {len(text)} chars from '{filename}'")

        if not text.strip():
            return jsonify({"error": "Could not extract text from this document. Make sure it is a text-based PDF (not a scanned image)."}), 400

        # Use up to 20k chars — enough for large estimates
        if len(text) > 20000:
            text = text[:20000]

        cats = ", ".join(SELECTION_CATEGORIES)
        prompt = f"""You are reviewing an insurance restoration estimate or damage report.

Your job: identify every line item where the homeowner needs to pick a specific product, material, brand, color, style, or finish.

This includes items like:
- Flooring (carpet, LVP, hardwood, tile — homeowner picks style/color)
- Cabinets (kitchen or bathroom — homeowner picks style/finish)
- Countertops (homeowner picks material/color)
- Paint (homeowner picks color/sheen for each room)
- Roofing shingles (homeowner picks color/style)
- Windows and doors (homeowner picks style/finish)
- Fixtures (faucets, lighting, ceiling fans — homeowner picks finish/style)
- Siding (homeowner picks color/material)
- Any other item where a specific product choice is needed

Categories available: {cats}

Rules:
- Include ANY material or finish line item even if the document does not explicitly say "client selects"
- Use the closest category from the list above
- "product" should be a short, clear name (e.g. "Kitchen LVP Flooring", "Master Bath Tile", "Exterior Paint")
- "notes" should be one sentence telling the homeowner what to decide (e.g. "Choose color and style for living room carpet")
- Return ONLY a valid JSON array, no other text

Document:
{text}"""

        response = openai.ChatCompletion.create(
            deployment_id=DEPLOYMENT,
            messages=[
                {"role": "system", "content": "You are a restoration project coordinator. Extract material selection items from estimates. Return only a valid JSON array of objects with keys: category, product, notes."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=2000,
            temperature=0.1,
        )

        raw = response["choices"][0]["message"]["content"].strip()
        print(f"[extract-selections] Raw AI response: {raw[:300]}")

        # Strip markdown code fences if present
        if "```" in raw:
            parts = raw.split("```")
            for part in parts:
                part = part.strip()
                if part.startswith("json"):
                    part = part[4:].strip()
                if part.startswith("["):
                    raw = part
                    break

        raw = raw.strip()
        # Find the JSON array even if there's surrounding text
        start = raw.find("[")
        end   = raw.rfind("]")
        if start != -1 and end != -1:
            raw = raw[start:end+1]

        selections = _json.loads(raw)
        if not isinstance(selections, list):
            raise ValueError("Expected a JSON array")

        # Sanitise each item
        clean = []
        for s in selections:
            product = str(s.get("product", "")).strip()
            if not product:
                continue
            cat = s.get("category", "Other")
            if cat not in SELECTION_CATEGORIES:
                cat = "Other"
            clean.append({
                "category": cat,
                "product":  product,
                "notes":    str(s.get("notes", "")).strip(),
            })

        print(f"[extract-selections] Returning {len(clean)} selections")
        return jsonify({"selections": clean, "textLength": len(text)})

    except Exception as e:
        print(f"[extract-selections] Error: {e}")
        return jsonify({"error": str(e)}), 500


BUDGET_ITEM_LABELS = [
    "Carpet", "Hardwood Flooring", "Laminate Flooring", "LVP / LVT Flooring",
    "Tile — Floor", "Tile — Shower / Tub", "Tile — Backsplash", "Subfloor",
    "Roofing / Shingles", "Siding", "Drywall", "Insulation", "Concrete / Foundation",
    "Deck / Patio", "Painting — Walls", "Painting — Ceilings", "Painting — Exterior",
    "Countertops", "Structural Repairs", "Framing", "Demo / Removal",
    "Baseboards / Trim", "Crown Molding", "Painting — Trim", "Kitchen Cabinets",
    "Gutters", "Fence", "Windows", "Interior Doors", "Exterior Doors",
    "Bathroom Vanity", "Toilet", "Bathtub / Shower", "Plumbing Fixtures",
    "Light Fixtures", "Ceiling Fans", "Appliances", "HVAC Unit", "Water Heater",
    "Electrical Panel", "Smoke / CO Detectors", "Labor", "Other",
]

import re as _re

SKETCH_KEYWORDS = ["sketch", "floor plan", "floorplan", "area summary", "room dimensions",
                   "diagram", "layout", "elevation", "sq ft", "linear ft", "perimeter",
                   "bedroom", "kitchen", "bathroom", "living room", "dining"]

ROOM_WORDS = _re.compile(
    r'\b(bedroom|bath|living|dining|kitchen|garage|hall|closet|entry|office|laundry|'
    r'utility|foyer|master|family|great|bonus|basement|attic|porch|deck|patio|stair|'
    r'room|area|floor)\b',
    _re.IGNORECASE,
)


def _find_sketch_page(fitz_doc):
    """Return the page index most likely to be the property sketch / floor plan.
    Prioritises the last quarter of the document (Xactimate puts sketch at end)."""
    n = len(fitz_doc)
    # Search last 4 pages first, then rest of doc
    order = list(range(max(0, n - 4), n))[::-1] + list(range(0, max(0, n - 4)))
    best_score = -1
    best_idx   = None
    for i in order:
        page  = fitz_doc[i]
        text  = (page.get_text() or "").lower()
        words = len(text.split())
        if words > 500:   # dense prose → skip
            continue
        score = sum(1 for kw in SKETCH_KEYWORDS if kw in text)
        if words < 80:    # sparse = likely graphics page
            score += 3
        if i >= max(0, n - 4):  # bonus for being in the last 4 pages
            score += 2
        if score > best_score:
            best_score = score
            best_idx   = i
    return best_idx


def _extract_sketch_rooms(fitz_page, scale=1.5):
    """Return text blocks from a sketch page that look like room/area labels."""
    blocks = fitz_page.get_text("blocks")
    rooms  = []
    seen   = set()
    for b in blocks:
        text = b[4].strip().replace("\n", " ")
        if not text or len(text) < 3:
            continue
        key = text.lower()
        if key in seen:
            continue
        # Skip pure dimension strings like "12.5'" or "144.00 SF"
        if _re.match(r'^[\d\.\s\'\"\,x×\*\/]+$', text):
            continue
        if _re.match(r'^\d+(\.\d+)?\s*(sf|lf|ft|\'|\")?$', text, _re.IGNORECASE):
            continue
        # Include room/area labels and short labels ≤ 40 chars
        if ROOM_WORDS.search(text) or (3 <= len(text) <= 40 and not text[0].isdigit()):
            seen.add(key)
            rooms.append({
                "name": text[:50],
                "xPct": round(b[0] * scale / (fitz_page.rect.width  * scale) * 100, 1),
                "yPct": round(b[1] * scale / (fitz_page.rect.height * scale) * 100, 1),
            })
    return rooms


@claim_chatbot_app.route("/extract-report", methods=["POST"])
def extract_report():
    import json as _json
    try:
        import fitz  # PyMuPDF
    except ImportError:
        fitz = None

    try:
        data         = request.json or {}
        download_url = data.get("fileUrl", "").strip()
        filename     = data.get("filename", "document")

        if not download_url:
            return jsonify({"error": "fileUrl is required"}), 400

        resp = http_requests.get(download_url, timeout=15)
        if resp.status_code != 200:
            return jsonify({"error": f"Could not download document: HTTP {resp.status_code}"}), 500

        content      = resp.content
        sketch_b64   = None
        sketch_rooms = []

        # ── Render sketch page with PyMuPDF ──────────────────────────────
        if fitz and filename.lower().endswith(".pdf"):
            try:
                fitz_doc   = fitz.open(stream=content, filetype="pdf")
                sketch_idx = _find_sketch_page(fitz_doc)
                if sketch_idx is not None:
                    page = fitz_doc[sketch_idx]
                    mat  = fitz.Matrix(2.0, 2.0)   # 2× for clarity
                    pix  = page.get_pixmap(matrix=mat)
                    sketch_b64   = base64.b64encode(pix.tobytes("png")).decode("utf-8")
                    sketch_rooms = _extract_sketch_rooms(page, scale=2.0)
                    print(f"[extract-report] Sketch page {sketch_idx}: {len(sketch_rooms)} room labels, img {len(sketch_b64)} chars")
                fitz_doc.close()
            except Exception as e:
                print(f"[extract-report] PyMuPDF error: {e}")

        # ── Extract text (pdfplumber — better for tables / line items) ───
        text = extract_text_from_bytes(content, filename)
        print(f"[extract-report] Extracted {len(text)} chars from '{filename}'")

        if not text.strip():
            return jsonify({"error": "Could not extract text from this document. Make sure it is a text-based PDF."}), 400

        if len(text) > 22000:
            text = text[:22000]

        cats   = ", ".join(SELECTION_CATEGORIES)
        labels = ", ".join(BUDGET_ITEM_LABELS)

        prompt = f"""You are a restoration project coordinator reviewing an insurance estimate or scope-of-work report.

The report contains line items grouped by room or trade section. Extract TWO lists.
Ignore photo captions, image descriptions, cover pages, summary pages, and signatures.

═══════════════════════════════════════════════════════════════
LIST 1 — SELECTIONS
Items where the homeowner must choose a specific product, material, color, style, or finish.

RULES — you MUST include a selection for EVERY occurrence of the following:

▸ PAINT / FINISH
  One entry per room or area that has ANY painting line item (repaint, prime, seal, finish coat, etc.)
  Include wall paint, ceiling paint, trim paint separately when in different rooms.
  category = "Paint"  |  product = "[Room] Paint" (e.g. "Living Room Wall Paint")

▸ CARPET
  One entry per room or area where carpet is installed or replaced.
  category = "Flooring"  |  product = "[Room] Carpet" (e.g. "Bedroom 1 Carpet")

▸ HARD-SURFACE FLOORING  (LVP, vinyl plank, laminate, hardwood)
  One entry per room or area.
  category = "Flooring"  |  product = "[Room] LVP Flooring" or appropriate type

▸ TILE — FLOOR
  One entry per room/area with floor tile.
  category = "Flooring"  |  product = "[Room] Floor Tile"

▸ TILE — SHOWER / TUB SURROUND / WALL TILE
  One entry per bathroom or area with shower/tub/wall tile.
  category = "Flooring"  |  product = "[Room] Shower Tile" or "Tub Surround Tile"

▸ TILE — BACKSPLASH
  One entry per kitchen or area with backsplash tile.
  category = "Flooring"  |  product = "[Room] Backsplash Tile"

▸ COUNTERTOPS
  One entry per location (kitchen counter, bathroom vanity top, etc.)
  category = "Countertops"  |  product = "[Location] Countertop"

▸ CABINETS
  One entry per location (kitchen cabinets, bathroom vanity cabinet, laundry cabinets, etc.)
  category = "Cabinets"  |  product = "[Location] Cabinets"

▸ BATHROOM VANITY
  One entry per bathroom that has a vanity line item.
  category = "Fixtures"  |  product = "[Bath] Vanity"

▸ LIGHT FIXTURES / RECESSED LIGHTS / CEILING FANS
  One entry per room or area with any lighting line item.
  category = "Fixtures"  |  product = "[Room] Light Fixture" or "Ceiling Fan"

▸ PLUMBING FIXTURES  (faucets, shower valves, tub fixtures, kitchen faucet, hose bibs)
  One entry per location.
  category = "Fixtures"  |  product = "[Location] Faucet" or "[Location] Shower Fixture"

▸ TRIM / BASEBOARDS / CASING / CROWN MOLDING
  One entry per area where trim is being replaced or installed.
  category = "Other"  |  product = "[Room] Baseboards" or "Door Casing"

▸ INTERIOR DOORS
  One entry per group of doors being replaced.
  category = "Other"  |  product = "Interior Doors"

▸ EXTERIOR DOORS
  One entry per exterior door.
  category = "Other"  |  product = "[Location] Exterior Door"

▸ ROOFING SHINGLES
  One entry for shingle color/style selection.
  category = "Roofing"  |  product = "Roofing Shingles"

▸ SIDING
  One entry for siding color/material.
  category = "Siding"  |  product = "Siding"

▸ WINDOWS
  One entry per group of windows being replaced.
  category = "Windows"  |  product = "Windows"

▸ ANY OTHER item requiring a product, material, brand, color, or style choice.

For each selection return:
  category — one of: {cats}
  product  — short label (room + item type), e.g. "Master Bedroom Carpet"
  room     — exact room/area name from the section header, or "General"
  notes    — one sentence describing the choice needed

═══════════════════════════════════════════════════════════════
LIST 2 — BUDGET ITEMS
Line items with measurable quantities (sq ft, lin ft, count, hours).

Include every line item that has a numeric quantity + unit of measure.
For each item return:
  label — closest match from: {labels}  (or a short custom label)
  room  — exact room/area name from the section header, or "General"
  qty   — numeric quantity (number only), or null
  unit  — one of: sq ft, lin ft, count, hrs, lump sum
  notes — optional: unit price or extra detail

═══════════════════════════════════════════════════════════════
Return ONLY valid JSON, no markdown, no extra text:
{{
  "selections": [{{"category":"...","product":"...","room":"...","notes":"..."}}],
  "budgetItems": [{{"label":"...","room":"...","qty":123,"unit":"sq ft","notes":""}}]
}}

Document:
{text}"""

        response = openai.ChatCompletion.create(
            deployment_id=DEPLOYMENT,
            messages=[
                {"role": "system", "content": (
                    "You are a restoration project coordinator. "
                    "Your task is to exhaustively extract every material selection item and every budget quantity from an insurance estimate. "
                    "Do not skip any room. Do not skip paint, carpet, tile, vanity, fixtures, or trim items. "
                    "Return only valid JSON."
                )},
                {"role": "user", "content": prompt},
            ],
            max_tokens=4000,
            temperature=0.1,
        )

        raw = response["choices"][0]["message"]["content"].strip()
        print(f"[extract-report] Raw AI response (first 400): {raw[:400]}")

        # Strip markdown fences
        if "```" in raw:
            for part in raw.split("```"):
                part = part.strip()
                if part.startswith("json"):
                    part = part[4:].strip()
                if part.startswith("{"):
                    raw = part
                    break

        raw = raw.strip()
        s = raw.find("{"); e = raw.rfind("}")
        if s != -1 and e != -1:
            raw = raw[s:e+1]

        parsed = _json.loads(raw)

        # ── Sanitize selections ──────────────────────────────────────────
        clean_sel = []
        for item in (parsed.get("selections") or []):
            product = str(item.get("product", "")).strip()
            if not product:
                continue
            cat = item.get("category", "Other")
            if cat not in SELECTION_CATEGORIES:
                cat = "Other"
            clean_sel.append({
                "category": cat,
                "product":  product,
                "room":     str(item.get("room", "General")).strip() or "General",
                "notes":    str(item.get("notes", "")).strip(),
            })

        # ── Sanitize budget items ────────────────────────────────────────
        VALID_UNITS = {"sq ft", "lin ft", "count", "hrs", "lump sum"}
        clean_bud = []
        for item in (parsed.get("budgetItems") or []):
            label = str(item.get("label", "")).strip()
            if not label:
                continue
            unit = str(item.get("unit", "sq ft")).strip().lower()
            if unit not in VALID_UNITS:
                unit = "sq ft"
            qty = item.get("qty")
            try:
                qty = float(qty) if qty is not None else None
            except (ValueError, TypeError):
                qty = None
            clean_bud.append({
                "label": label,
                "room":  str(item.get("room", "General")).strip() or "General",
                "qty":   qty,
                "unit":  unit,
                "notes": str(item.get("notes", "")).strip(),
            })

        print(f"[extract-report] {len(clean_sel)} selections, {len(clean_bud)} budget items, {len(sketch_rooms)} sketch labels, sketch={'yes' if sketch_b64 else 'no'}")
        return jsonify({
            "selections":   clean_sel,
            "budgetItems":  clean_bud,
            "sketchBase64": sketch_b64,
            "sketchRooms":  sketch_rooms,
            "textLength":   len(text),
        })

    except Exception as e:
        print(f"[extract-report] Error: {e}")
        return jsonify({"error": str(e)}), 500


@claim_chatbot_app.route("/ask", methods=["POST"])
def ask():
    try:
        user_id = request.json.get("uid")
        question = request.json.get("question")
        selected_doc_ids = request.json.get("selectedDocIds", [])

        if not user_id or not question:
            return jsonify({"error": "uid and question are required"}), 400

        db = firestore.client()

        context = ""
        for doc_id in selected_doc_ids:
            cache_snap = (
                db.collection("users")
                .document(user_id)
                .collection("document_cache")
                .document(doc_id)
                .get()
            )
            if cache_snap.exists:
                data = cache_snap.to_dict()
                text = data.get("extractedText", "")
                if text.strip():
                    context += f"\n--- {data.get('filename', doc_id)} ---\n{text}\n"
            else:
                # Cache miss: download, cache, and use immediately
                doc_snap = (
                    db.collection("users")
                    .document(user_id)
                    .collection("documents")
                    .document(doc_id)
                    .get()
                )
                if doc_snap.exists:
                    doc_data = doc_snap.to_dict()
                    filename = doc_data.get("name", "")
                    dl_url = doc_data.get("fileUrl", "")
                    if dl_url:
                        try:
                            resp = http_requests.get(dl_url, timeout=15)
                            if resp.status_code == 200:
                                text = extract_text_from_bytes(resp.content, filename)
                                if len(text) > MAX_CACHE_CHARS:
                                    text = text[:MAX_CACHE_CHARS]
                                db.collection("users").document(user_id).collection("document_cache").document(doc_id).set({
                                    "filename": filename,
                                    "extractedText": text,
                                    "processedAt": time.time(),
                                })
                                if text.strip():
                                    context += f"\n--- {filename} ---\n{text}\n"
                        except Exception as e:
                            print(f"Fallback download error for {doc_id}: {e}")

        # Fetch the last 10 chat messages for conversational continuity
        history_snap = (
            db.collection("users")
            .document(user_id)
            .collection("chat_history")
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(10)
            .stream()
        )
        history = list(reversed([h.to_dict() for h in history_snap]))

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a helpful insurance claims assistant. "
                    "Answer questions about the user's claim status, process, and uploaded documents. "
                    "Be clear, empathetic, and concise. If the answer is in the documents, cite it directly."
                ),
            }
        ]

        if context:
            messages.append({
                "role": "user",
                "content": f"Here are my insurance documents for reference:\n{context}",
            })

        for turn in history[-5:]:
            messages.append({"role": "user", "content": turn.get("question", "")})
            messages.append({"role": "assistant", "content": turn.get("response", "")})

        messages.append({"role": "user", "content": question})

        response = openai.ChatCompletion.create(
            deployment_id=DEPLOYMENT,
            messages=messages,
            max_tokens=600,
            temperature=0.7,
        )

        bot_response = response["choices"][0]["message"]["content"].strip()

        db.collection("users").document(user_id).collection("chat_history").add({
            "question": question,
            "response": bot_response,
            "timestamp": time.time(),
        })

        return jsonify({"response": bot_response})

    except Exception as e:
        print(f"Claim chatbot error: {e}")
        return jsonify({"error": str(e)}), 500
