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

read -r -p "Disk Size (GB) [default: 4G]: " CT_DISK
CT_DISK=${CT_DISK:-4G}

read -r -p "Memory (MB) [default: 512]: " CT_RAM
CT_RAM=${CT_RAM:-512}

read -r -p "CPU Cores [default: 1]: " CT_CORES
CT_CORES=${CT_CORES:-1}

read -r -p "Network Bridge [default: vmbr0]: " CT_BRIDGE
CT_BRIDGE=${CT_BRIDGE:-vmbr0}

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
    --memory "$CT_RAM" \
    --swap 512 \
    --rootfs "$CT_STORAGE:$CT_DISK" \
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
# Download & execute setup script inside the container
pct exec "$CT_ID" -- bash -c "curl -fsSL https://raw.githubusercontent.com/volski/kids-tasker/main/proxmox/setup-service.sh | bash"

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
