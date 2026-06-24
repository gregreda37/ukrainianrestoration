#!/usr/bin/env bash
# Start the Flask backend for local development.
# Run from the project root: bash scripts/dev-backend.sh

set -e

BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
cd "$BACKEND_DIR"

# Use Python 3.11 to match the Cloud Run Docker image (3.14 breaks numpy/scipy)
PYTHON=$(command -v python3.11 || command -v python3)
PY_VER=$($PYTHON --version 2>&1)
echo "Using $PY_VER"

# Create a virtualenv if one doesn't exist
if [ ! -d ".venv" ]; then
  echo "Creating virtualenv..."
  $PYTHON -m venv .venv
fi

source .venv/bin/activate

# Install/update dependencies
pip install -q -r requirements.txt

echo ""
echo "Starting Flask backend at http://localhost:5001"
echo "Press Ctrl+C to stop."
echo ""

FLASK_ENV=development python main.py
