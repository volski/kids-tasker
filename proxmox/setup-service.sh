#!/bin/bash
# ==============================================================================
# Kids Tasker - Standalone Service Setup for Proxmox LXC / Debian / Ubuntu
# ==============================================================================
set -e

echo "=== [1/5] Updating package manager & installing prerequisites ==="
apt-get update -y
apt-get install -y curl git ca-certificates gnupg

echo "=== [2/5] Installing Node.js 20 LTS ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
fi
echo "Node.js version: $(node -v)"
echo "NPM version: $(npm -v)"

echo "=== [3/5] Setting up Kids Tasker in /opt/kids-tasker ==="
APP_DIR="/opt/kids-tasker"
DATA_DIR="/opt/kids-tasker/data"

if [ -d "$APP_DIR/.git" ]; then
    echo "Updating existing repository..."
    cd "$APP_DIR"
    git pull
else
    echo "Cloning repository..."
    git clone https://github.com/volski/kids-tasker.git "$APP_DIR"
    cd "$APP_DIR"
fi

mkdir -p "$DATA_DIR"

echo "Installing production dependencies..."
npm ci --omit=dev

echo "=== [4/5] Creating systemd service ==="
cat << 'EOF' > /etc/systemd/system/kids-tasker.service
[Unit]
Description=Kids Tasker Standalone Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kids-tasker
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TASKS_FILE=/opt/kids-tasker/data/tasks.json
ExecStart=/usr/bin/node /opt/kids-tasker/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "=== [5/5] Enabling and starting Kids Tasker service ==="
systemctl daemon-reload
systemctl enable kids-tasker.service
systemctl restart kids-tasker.service

sleep 2

if systemctl is-active --quiet kids-tasker.service; then
    IP_ADDR=$(hostname -I | awk '{print $1}')
    echo ""
    echo "=================================================================="
    echo "🎉 Kids Tasker is successfully running on Proxmox!"
    echo "📱 Tablet Board:    http://${IP_ADDR}:3000"
    echo "👑 Parent Portal:   http://${IP_ADDR}:3000/parent"
    echo "=================================================================="
    echo "Service commands:"
    echo "  systemctl status kids-tasker"
    echo "  journalctl -u kids-tasker -f"
    echo "  systemctl restart kids-tasker"
    echo "=================================================================="
else
    echo "❌ Service failed to start. Check logs using: journalctl -u kids-tasker -xe"
    exit 1
fi
