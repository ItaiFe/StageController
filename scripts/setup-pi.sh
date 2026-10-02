#!/bin/bash
set -e

echo "Setting up Stage Controller on Raspberry Pi..."

# Install uv if not present
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source $HOME/.local/bin/env
fi

# Backend setup
echo "Setting up backend..."
cd backend
uv sync --frozen

# Frontend build
echo "Building frontend..."
cd ../frontend
npm ci --prefer-offline
npm run build

# Copy frontend build to backend static folder
echo "Setting up static files..."
mkdir -p ../backend/static
cp -r dist/* ../backend/static/

echo "Done! Run with: cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"
