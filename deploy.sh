#!/bin/bash
# Deploy StageController to Raspberry Pi
# Usage: ./deploy.sh pi@raspberrypi.local

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 user@host"
    echo "Example: $0 pi@raspberrypi.local"
    exit 1
fi

TARGET="$1"
REMOTE_DIR="/home/pi/stagecontroller"

echo "=== Deploying to $TARGET ==="

# Create remote directory
ssh "$TARGET" "mkdir -p $REMOTE_DIR"

# Sync files (excluding venv, node_modules, etc.)
echo "Syncing files..."
rsync -avz --delete \
    --exclude '.venv' \
    --exclude 'node_modules' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude '.DS_Store' \
    backend/ "$TARGET:$REMOTE_DIR/backend/"

rsync -avz \
    --exclude '.DS_Store' \
    data/ "$TARGET:$REMOTE_DIR/data/"

# Copy systemd service file
echo "Installing systemd service..."
ssh "$TARGET" "sudo tee /etc/systemd/system/stagecontroller.service" << 'EOF'
[Unit]
Description=StageController Backend
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stagecontroller/backend
Environment=PATH=/home/pi/stagecontroller/backend/.venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/pi/stagecontroller/backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Install dependencies on Pi
echo "Installing dependencies..."
ssh "$TARGET" << 'REMOTE_SCRIPT'
cd /home/pi/stagecontroller/backend

# Install system dependencies
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv mpv libmpv-dev

# Create venv and install Python packages
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install uv
.venv/bin/uv sync

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable stagecontroller
sudo systemctl restart stagecontroller

echo "=== Deployment complete ==="
echo "Service status:"
sudo systemctl status stagecontroller --no-pager
REMOTE_SCRIPT

echo ""
echo "StageController is now running at http://$TARGET:8000"
