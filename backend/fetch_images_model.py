import os
import requests
import logging
from flask import Blueprint, Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

# CLIP / PyTorch are optional — too large for standard Cloud Run instances.
# The classify endpoints return 503 when unavailable.
try:
    import torch
    import clip
    _CLIP_AVAILABLE = True
    _device = "cuda" if torch.cuda.is_available() else "cpu"
    _model, _preprocess = clip.load("ViT-B/32", device=_device)
except ImportError:
    _CLIP_AVAILABLE = False
    _device = _model = _preprocess = None

# Blueprint (used when registered in main.py)
classify_app = Blueprint("classify", __name__)

# Standalone app (used when run directly)
app = Flask(__name__)
CORS(app)

logging.basicConfig(
    filename="image_classifier.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)


def fetch_companycam_images(project_id, api_key):
    url = f"https://api.companycam.com/v2/projects/{project_id}/photos"
    headers = {"Authorization": f"Bearer {api_key}"}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        logging.info(f"Successfully fetched images for project {project_id}")
        raw = response.json()
        return raw if isinstance(raw, list) else raw.get("data", [])
    else:
        logging.error(f"Error fetching images: {response.status_code}, {response.text}")
        return []


def classify_images(image_urls, descriptions):
    if not _CLIP_AVAILABLE:
        return [{"image_url": u, "error": "CLIP model not available on this server"} for u in image_urls]

    results = []
    text_inputs = clip.tokenize(descriptions).to(_device)

    with torch.no_grad():
        text_features = _model.encode_text(text_inputs)
        text_features /= text_features.norm(dim=-1, keepdim=True)

    for image_url in image_urls:
        try:
            response = requests.get(image_url, stream=True)
            image = Image.open(response.raw).convert("RGB")
            image_input = _preprocess(image).unsqueeze(0).to(_device)

            with torch.no_grad():
                image_features = _model.encode_image(image_input)
                image_features /= image_features.norm(dim=-1, keepdim=True)

            similarity = (image_features @ text_features.T).squeeze(0).cpu().numpy()
            best_match_idx = similarity.argmax()
            results.append({
                "image_url": image_url,
                "best_match": descriptions[best_match_idx],
                "similarity_score": float(similarity[best_match_idx])
            })
        except Exception as e:
            logging.error(f"Error processing image {image_url}: {e}")
            results.append({"image_url": image_url, "error": str(e)})

    return results


@classify_app.route('/classify-images', methods=['POST'])
@app.route('/classify-images', methods=['POST'])
def classify_images_endpoint():
    if not _CLIP_AVAILABLE:
        return jsonify({"error": "CLIP model not available on this server"}), 503
    try:
        data = request.json
        project_id = data.get("project_id")
        api_key = data.get("api_key")
        descriptions = data.get("descriptions", ["Dri-Eaz Machine", "Scrubbing Photo", "PPE", "Demo Photo"])

        if not project_id or not api_key:
            return jsonify({"error": "Missing project_id or api_key"}), 400

        images = fetch_companycam_images(project_id, api_key)
        image_urls = []
        for img in images:
            uris = img.get("uris", [])
            url = next((u["url"] for u in uris if u.get("type") == "original"), None) or \
                  next((u["url"] for u in uris if u.get("type") == "large"), None) or \
                  next((u["url"] for u in uris), {}).get("url")
            if url:
                image_urls.append(url)

        results = classify_images(image_urls, descriptions)
        logging.info(f"Classification results: {results}")
        return jsonify({"results": results})
    except Exception as e:
        logging.error(f"Error classifying images: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True)
