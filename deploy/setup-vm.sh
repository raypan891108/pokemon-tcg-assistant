#!/usr/bin/env bash
# One-time setup on a fresh Debian/Ubuntu Google Cloud VM.
# Run on the VM:  sudo bash setup-vm.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "請用 sudo 執行：sudo bash setup-vm.sh" >&2
  exit 1
fi

echo "==> 安裝 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# e2-micro has 1 GB RAM; swap keeps the frontend build from running out of memory
echo "==> 建立 2 GB swap"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> 建立資料夾 /opt/tcg"
mkdir -p /opt/tcg/app /opt/tcg/data
# The app container runs as the "node" user (uid 1000)
chown -R 1000:1000 /opt/tcg/data

if [ ! -f /opt/tcg/.env ]; then
  echo "==> 設定網址與登入密碼"
  IP=$(curl -fs -H "Metadata-Flavor: Google" \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip || true)
  DEFAULT_DOMAIN=""
  [ -n "$IP" ] && DEFAULT_DOMAIN="${IP//./-}.sslip.io"
  read -rp "網址（直接按 Enter 使用 ${DEFAULT_DOMAIN:-請輸入你的網域}）: " DOMAIN
  DOMAIN=${DOMAIN:-$DEFAULT_DOMAIN}
  if [ -z "$DOMAIN" ]; then
    echo "沒有網址，無法繼續" >&2
    exit 1
  fi
  while true; do
    read -rsp "設定網站登入密碼（至少 8 個字元，不能包含單引號 '）: " PASSWORD; echo
    if [ ${#PASSWORD} -lt 8 ]; then echo "密碼太短，請再輸入一次"; continue; fi
    if [[ "$PASSWORD" == *"'"* ]]; then echo "密碼不能包含單引號，請再輸入一次"; continue; fi
    break
  done
  umask 077
  # Single quotes keep characters such as $ literal when Docker Compose reads the file
  cat > /opt/tcg/.env <<EOF
DOMAIN=${DOMAIN}
APP_PASSWORD='${PASSWORD}'
SESSION_SECRET=$(openssl rand -hex 32)
EOF
  echo "已寫入 /opt/tcg/.env（只有 root 可讀）"
fi

echo
echo "✅ 主機設定完成。回到 Mac 執行 deploy/deploy.sh 部署網站。"
