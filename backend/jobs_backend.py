from flask import request, jsonify, Blueprint
from firebase_admin import firestore

jobs_app = Blueprint("jobs", __name__)

MITIGATION_MAX  = 5   # 0–4 are step indices, 5 = all done
CONSTRUCTION_MAX = 4  # 0–3 are step indices, 4 = all done


@jobs_app.route("/update-status", methods=["POST"])
def update_status():
    """
    Update a user's claim job progress.

    Body:
      uid           – the Firebase UID of the homeowner
      jobId            – Firestore document ID under users/{uid}/jobs/
      mitigationStep   – (optional) int 0–5
      constructionStep – (optional) int 0–4
      name             – (optional) string label for the claim
    """
    try:
        data             = request.json or {}
        user_id          = data.get("uid")
        job_id           = data.get("jobId")

        if not user_id or not job_id:
            return jsonify({"error": "uid and jobId are required"}), 400

        db      = firestore.client()
        job_ref = db.collection("users").document(user_id).collection("jobs").document(job_id)

        updates = {}

        if "mitigationStep" in data:
            val = int(data["mitigationStep"])
            if not (0 <= val <= MITIGATION_MAX):
                return jsonify({"error": f"mitigationStep must be 0–{MITIGATION_MAX}"}), 400
            updates["mitigationStep"] = val

        if "constructionStep" in data:
            val = int(data["constructionStep"])
            if not (0 <= val <= CONSTRUCTION_MAX):
                return jsonify({"error": f"constructionStep must be 0–{CONSTRUCTION_MAX}"}), 400
            updates["constructionStep"] = val

        if "name" in data:
            updates["name"] = str(data["name"])

        if not updates:
            return jsonify({"error": "No fields to update"}), 400

        job_ref.set(updates, merge=True)

        return jsonify({"status": "updated", "fields": list(updates.keys())})

    except Exception as e:
        print(f"Update status error: {e}")
        return jsonify({"error": str(e)}), 500


@jobs_app.route("/get-status", methods=["GET"])
def get_status():
    """
    GET /jobs/get-status?uid=xxx
    Returns the first job document for the user.
    """
    try:
        user_id = request.args.get("uid")
        if not user_id:
            return jsonify({"error": "uid is required"}), 400

        db   = firestore.client()
        snap = db.collection("users").document(user_id).collection("jobs").limit(1).stream()
        docs = [{"id": d.id, **d.to_dict()} for d in snap]

        if not docs:
            return jsonify({"job": None})

        return jsonify({"job": docs[0]})

    except Exception as e:
        print(f"Get status error: {e}")
        return jsonify({"error": str(e)}), 500
