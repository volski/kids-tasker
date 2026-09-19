#!/usr/bin/env bash
# ==============================================================================
# Kids Tasker - Automated Proxmox VE LXC Container Creator
# Run directly in the Proxmox VE Host Shell (Datacenter -> Node -> Shell)
# ==============================================================================
set -e

# Verify Proxmox environment
if ! command -v pveversion >/dev/null 2>&1; then
    echo "❌ Error: This script must be run on a Proxmox VE host!"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Error: This script must be run as root on the Proxmox VE host."
    exit 1
fi

echo "=================================================================="
echo "      🚀 Kids Tasker - Proxmox VE LXC Container Setup"
echo "=================================================================="

# Prompt for GitHub Token if private repo
if [ -z "$GITHUB_TOKEN" ]; then
    echo ""
    echo "🔒 Private Repository Access:"
    echo "Because this repository is private, a GitHub Personal Access Token (PAT) is required to clone it."
    echo "(Generate one in 10 seconds at: https://github.com/settings/tokens with 'repo' scope)"
    read -r -s -p "Enter GitHub Token (input is hidden): " GITHUB_TOKEN
    echo ""
fi

# Detect Next Free CT ID
NEXT_ID=$(pvesh get /cluster/nextid)
read -r -p "Container ID [default: $NEXT_ID]: " CT_ID
CT_ID=${CT_ID:-$NEXT_ID}

read -r -p "Hostname [default: kids-tasker]: " CT_HOSTNAME
CT_HOSTNAME=${CT_HOSTNAME:-kids-tasker}

# Detect Storage Pools
DEFAULT_STORAGE=$(pvesm status -content rootdir | awk 'NR>1 {print $1}' | head -n 1)
DEFAULT_STORAGE=${DEFAULT_STORAGE:-local-lvm}
read -r -p "Storage pool for disk [default: $DEFAULT_STORAGE]: " CT_STORAGE
CT_STORAGE=${CT_STORAGE:-$DEFAULT_STORAGE}

read -r -p "Disk Size in GB [default: 4]: " CT_DISK
CT_DISK=${CT_DISK:-4}
CT_DISK_SIZE=$(echo "$CT_DISK" | tr -d '[:alpha:]')
CT_DISK_SIZE=${CT_DISK_SIZE:-4}

read -r -p "Memory in MB [default: 512]: " CT_RAM
CT_RAM=${CT_RAM:-512}
CT_RAM_SIZE=$(echo "$CT_RAM" | tr -d '[:alpha:]')
CT_RAM_SIZE=${CT_RAM_SIZE:-512}

read -r -p "CPU Cores [default: 1]: " CT_CORES
CT_CORES=${CT_CORES:-1}

read -r -p "Network Bridge [default: vmbr0]: " CT_BRIDGE
CT_BRIDGE=${CT_BRIDGE:-vmbr0}

# Check if container ID already exists
if pct status "$CT_ID" >/dev/null 2>&1; then
    echo "⚠️ Container $CT_ID already exists."
    read -r -p "Do you want to destroy existing CT $CT_ID and recreate it? [y/N]: " DESTROY_CT
    if [[ "$DESTROY_CT" =~ ^[Yy]$ ]]; then
        pct stop "$CT_ID" >/dev/null 2>&1 || true
        pct destroy "$CT_ID" >/dev/null 2>&1 || true
    else
        echo "Please re-run the script and select another Container ID."
        exit 1
    fi
fi

# Update Template Catalog & Detect Debian 12 Template
echo ""
echo "=== [1/4] Checking Debian 12 Template ==="
pveam update >/dev/null 2>&1 || true

TEMPLATE_STORAGE=$(pvesm status -content vztmpl | awk 'NR>1 {print $1}' | head -n 1)
TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-local}

DEBIAN_TMPL=$(pveam available -section system | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|xz|gz)$' | tail -n 1)

if [ -z "$DEBIAN_TMPL" ]; then
    echo "❌ Error: Could not find Debian 12 template in Proxmox catalog."
    exit 1
fi

echo "Template: $DEBIAN_TMPL"
if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$DEBIAN_TMPL"; then
    echo "Downloading template to $TEMPLATE_STORAGE..."
    pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TMPL"
fi

TEMPLATE_PATH="$TEMPLATE_STORAGE:vztmpl/$DEBIAN_TMPL"

echo ""
echo "=== [2/4] Creating LXC Container $CT_ID ($CT_HOSTNAME) ==="
pct create "$CT_ID" "$TEMPLATE_PATH" \
    --hostname "$CT_HOSTNAME" \
    --cores "$CT_CORES" \
    --memory "$CT_RAM_SIZE" \
    --swap 512 \
    --rootfs "${CT_STORAGE}:${CT_DISK_SIZE}" \
    --net0 "name=eth0,bridge=$CT_BRIDGE,ip=dhcp,type=veth" \
    --ostype debian \
    --unprivileged 1 \
    --features nesting=1 \
    --onboot 1 \
    --start 1

echo "Waiting for container to boot and acquire network (DHCP)..."
for i in {1..30}; do
    CT_IP=$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)
    if [ -n "$CT_IP" ]; then
        break
    fi
    sleep 1
done

if [ -z "$CT_IP" ]; then
    echo "⚠️ Warning: Container did not receive IP address via DHCP yet. Using localhost inside container."
    CT_IP="<CT_IP>"
fi

echo "Container IP: $CT_IP"

echo ""
echo "=== [3/4] Installing Node.js & Kids Tasker inside container ==="
pct exec "$CT_ID" -- env GITHUB_TOKEN="$GITHUB_TOKEN" bash -c '
set -e
echo "Updating packages..."
apt-get update -y >/dev/null 2>&1
apt-get install -y curl git ca-certificates gnupg >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
    echo "Installing Node.js 20 LTS..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes >/dev/null 2>&1
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list >/dev/null 2>&1
    apt-get update -y >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1
fi

echo "Node.js $(node -v) installed."

APP_DIR="/opt/kids-tasker"
DATA_DIR="/opt/kids-tasker/data"

if [ -f "$APP_DIR/server.js" ]; then
    echo "Files found in $APP_DIR. Skipping clone..."
    cd "$APP_DIR"
elif [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git pull || true
else
    echo "Cloning Kids Tasker from private GitHub..."
    if [ -n "$GITHUB_TOKEN" ]; then
        git clone "https://${GITHUB_TOKEN}@github.com/volski/kids-tasker.git" "$APP_DIR"
    else
        git clone https://github.com/volski/kids-tasker.git "$APP_DIR"
    fi
    cd "$APP_DIR"
fi

mkdir -p "$DATA_DIR"

echo "Installing production npm packages..."
npm ci --omit=dev >/dev/null 2>&1

echo "Setting up systemd service..."
cat << "EOF_SVC" > /etc/systemd/system/kids-tasker.service
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

[Install]
WantedBy=multi-user.target
EOF_SVC

systemctl daemon-reload
systemctl enable kids-tasker.service >/dev/null 2>&1
systemctl restart kids-tasker.service
'

sleep 2

echo ""
echo "=================================================================="
echo "🎉 Kids Tasker is ready and running in Proxmox LXC Container $CT_ID!"
echo "=================================================================="
echo "📱 Kids Tablet Board:  http://${CT_IP}:3000"
echo "👑 Parent Dashboard:  http://${CT_IP}:3000/parent"
echo "=================================================================="
echo "Useful Commands:"
echo "  pct enter $CT_ID                  # Open container shell"
echo "  pct exec $CT_ID systemctl status kids-tasker"
echo "  pct exec $CT_ID journalctl -u kids-tasker -f"
echo "=================================================================="
