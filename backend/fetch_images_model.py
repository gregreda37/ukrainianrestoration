import os
import requests
import logging
from flask import Blueprint, Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import torch
import clip
from torchvision.transforms import Compose, Resize, CenterCrop, ToTensor, Normalize

# Blueprint (used when registered in main.py)
classify_app = Blueprint("classify", __name__)

# Standalone app (used when run directly)
app = Flask(__name__)
CORS(app)

# Configure logging
logging.basicConfig(
    filename="image_classifier.log",  # Log file name
    level=logging.INFO,  # Log level
    format="%(asctime)s - %(levelname)s - %(message)s"  # Log format
)

# Load CLIP model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

# Helper function to fetch images from CompanyCam
def fetch_companycam_images(project_id, api_key):
    """
    Fetches all images for a given CompanyCam project.
    """
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

# Helper function to classify images
def classify_images(image_urls, descriptions):
    """
    Classifies images based on similarity to given descriptions.
    """
    results = []

    # Preprocess descriptions for CLIP
    text_inputs = clip.tokenize(descriptions).to(device)

    with torch.no_grad():
        text_features = model.encode_text(text_inputs)
        text_features /= text_features.norm(dim=-1, keepdim=True)

    for image_url in image_urls:
        try:
            # Download and preprocess the image
            response = requests.get(image_url, stream=True)
            image = Image.open(response.raw).convert("RGB")
            image_input = preprocess(image).unsqueeze(0).to(device)

            # Encode the image using CLIP
            with torch.no_grad():
                image_features = model.encode_image(image_input)
                image_features /= image_features.norm(dim=-1, keepdim=True)

            # Calculate similarity scores
            similarity = (image_features @ text_features.T).squeeze(0).cpu().numpy()
            best_match_idx = similarity.argmax()
            results.append({
                "image_url": image_url,
                "best_match": descriptions[best_match_idx],
                "similarity_score": float(similarity[best_match_idx])
            })
        except Exception as e:
            logging.error(f"Error processing image {image_url}: {e}")
            results.append({
                "image_url": image_url,
                "error": str(e)
            })

    return results

@classify_app.route('/classify-images', methods=['POST'])
@app.route('/classify-images', methods=['POST'])
def classify_images_endpoint():
    """
    Endpoint to classify images from a CompanyCam project.
    """
    try:
        # Get request data
        data = request.json
        project_id = data.get("project_id")
        api_key = data.get("api_key")
        descriptions = data.get("descriptions", ["Dri-Eaz Machine", "Scrubbing Photo", "PPE", "Demo Photo"])

        if not project_id or not api_key:
            error_message = {"error": "Missing project_id or api_key"}
            logging.error(f"Request failed: {error_message}")
            return jsonify(error_message), 400

        # Fetch images from CompanyCam
        images = fetch_companycam_images(project_id, api_key)
        image_urls = []
        for img in images:
            uris = img.get("uris", [])
            url = next((u["url"] for u in uris if u.get("type") == "original"), None) or \
                  next((u["url"] for u in uris if u.get("type") == "large"), None) or \
                  next((u["url"] for u in uris), {}).get("url")
            if url:
                image_urls.append(url)

        # Classify images
        results = classify_images(image_urls, descriptions)

        # Log the results
        logging.info(f"Classification results: {results}")

        # Return results
        return jsonify({"results": results})
    except Exception as e:
        error_message = {"error": str(e)}
        logging.error(f"Error classifying images: {error_message}")
        return jsonify(error_message), 500

if __name__ == '__main__':
    app.run(debug=True)