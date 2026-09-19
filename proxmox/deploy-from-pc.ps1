<#
.SYNOPSIS
  Deploy Kids Tasker directly from this PC to Proxmox VE without needing GitHub access.
.DESCRIPTION
  Packages the local source files (server.js, icons/, package.json) into an archive,
  transfers it to Proxmox via SCP/SSH, and automatically sets up or updates the LXC container.
.EXAMPLE
  .\proxmox\deploy-from-pc.ps1 -ProxmoxHost "192.168.1.100"
#>

param (
    [Parameter(Mandatory = $true, HelpMessage = "IP address or hostname of your Proxmox VE host")]
    [string]$ProxmoxHost,

    [Parameter(Mandatory = $false)]
    [string]$ProxmoxUser = "root",

    [Parameter(Mandatory = $false)]
    [string]$ContainerId = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " 🚀 Deploying Kids Tasker from Local PC to Proxmox VE" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Split-Path -Parent $scriptDir
$archivePath = Join-Path $projectRoot "kids-tasker-bundle.tar.gz"

# 1. Create Tarball of standalone application files
Write-Host "=== [1/4] Packaging local application files ===" -ForegroundColor Yellow
if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
}

# Create tarball using built-in Windows tar (available on Win 10/11)
$filesToArchive = @("server.js", "package.json", "package-lock.json", "icons", "tasks.example.json")
$prevPwd = Get-Location
Set-Location $projectRoot
try {
    tar -czf "kids-tasker-bundle.tar.gz" server.js package.json package-lock.json icons tasks.example.json
} finally {
    Set-Location $prevPwd
}

if (-not (Test-Path $archivePath)) {
    Write-Error "Failed to create archive bundle!"
}

Write-Host "Archive created: $([Math]::Round((Get-Item $archivePath).Length / 1KB, 1)) KB" -ForegroundColor Green

# 2. Transfer archive and helper script to Proxmox
Write-Host "=== [2/4] Uploading bundle to Proxmox ($ProxmoxUser@$ProxmoxHost) ===" -ForegroundColor Yellow
$remoteTmp = "/tmp/kids-tasker-deploy"
ssh "$ProxmoxUser@$ProxmoxHost" "mkdir -p $remoteTmp"
scp $archivePath "$ProxmoxUser@${ProxmoxHost}:${remoteTmp}/bundle.tar.gz"
scp (Join-Path $scriptDir "create-lxc.sh") "$ProxmoxUser@${ProxmoxHost}:${remoteTmp}/create-lxc.sh"

# Clean up local archive
Remove-Item $archivePath -Force

# 3. Execute setup on Proxmox
Write-Host "=== [3/4] Installing and configuring on Proxmox ===" -ForegroundColor Yellow
$remoteScript = @"
set -e
REMOTE_TMP="$remoteTmp"

# Check if ContainerId was provided
CT_ID="$ContainerId"
if [ -z "`$CT_ID" ]; then
    # Look for existing container with hostname kids-tasker
    EXISTING_CT=`$(pct list | awk '`$3 == "kids-tasker" {print `$1}' | head -n 1)
    if [ -n "`$EXISTING_CT" ]; then
        echo "Found existing kids-tasker container: `$EXISTING_CT"
        CT_ID="`$EXISTING_CT"
    fi
fi

if [ -z "`$CT_ID" ]; then
    echo "Creating new container via create-lxc.sh..."
    export GITHUB_TOKEN="LOCAL_BUNDLE"
    bash `$REMOTE_TMP/create-lxc.sh
    CT_ID=`$(pct list | awk '`$3 == "kids-tasker" {print `$1}' | head -n 1)
fi

echo "Copying application bundle into container `$CT_ID..."
pct exec "`$CT_ID" -- mkdir -p /opt/kids-tasker/data
pct push "`$CT_ID" "`$REMOTE_TMP/bundle.tar.gz" "/opt/kids-tasker/bundle.tar.gz"

echo "Extracting bundle and installing dependencies inside container..."
pct exec "`$CT_ID" -- bash -c '
    cd /opt/kids-tasker
    tar -xzf bundle.tar.gz
    rm bundle.tar.gz
    npm ci --omit=dev
    systemctl restart kids-tasker || true
'

CT_IP=`$(pct exec "`$CT_ID" -- hostname -I 2>/dev/null | awk '{print `$1}')

echo ""
echo "=================================================================="
echo "🎉 Kids Tasker successfully deployed to Proxmox LXC Container `$CT_ID!"
echo "=================================================================="
echo "📱 Tablet Board:    http://`$CT_IP:3000"
echo "👑 Parent Portal:   http://`$CT_IP:3000/parent"
echo "=================================================================="

rm -rf "`$REMOTE_TMP"
"@

# Run over SSH
ssh -t "$ProxmoxUser@$ProxmoxHost" "$remoteScript"

Write-Host ""
Write-Host "Deployment completed successfully! 🚀" -ForegroundColor Green
