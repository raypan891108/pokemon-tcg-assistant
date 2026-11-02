#!/usr/bin/env bash
# Deploy the latest commit to the Google Cloud VM. Run on your Mac from the project folder:
#   VM=tcg-assistant ZONE=us-west1-b ./deploy/deploy.sh
# Only committed changes are deployed (uses `git archive HEAD`).
set -euo pipefail

VM=${VM:-tcg-assistant}
ZONE=${ZONE:-us-west1-b}

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain -- . ':!backend/data')" ]; then
  echo "⚠️  有尚未 commit 的修改，這些修改不會被部署：" >&2
  git status --short -- . ':!backend/data' >&2
  echo >&2
fi

echo "==> 上傳程式碼（$(git rev-parse --short HEAD)）到 $VM"
# Replace only the app folder; /opt/tcg/data and /opt/tcg/.env are left alone
git archive --format=tar HEAD | gcloud compute ssh "$VM" --zone "$ZONE" --command \
  'sudo rm -rf /opt/tcg/app && sudo mkdir -p /opt/tcg/app && sudo tar -x -C /opt/tcg/app'

echo "==> 建置並重新啟動"
gcloud compute ssh "$VM" --zone "$ZONE" --command \
  'cd /opt/tcg/app/deploy && sudo docker compose --env-file /opt/tcg/.env up -d --build && sudo docker image prune -f >/dev/null && sudo grep ^DOMAIN= /opt/tcg/.env'

echo
echo "✅ 部署完成，請開啟上面顯示的網址（https://<DOMAIN>）"
