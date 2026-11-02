#!/usr/bin/env bash
# Run the site as a macOS background service (launchd LaunchAgent): it starts when you
# log in, restarts if it crashes, and keeps running after the terminal is closed.
#
#   ./scripts/autostart.sh install     build the frontend and start the service
#   ./scripts/autostart.sh restart     rebuild after code changes and restart
#   ./scripts/autostart.sh status      show whether it is running
#   ./scripts/autostart.sh logs        follow the log
#   ./scripts/autostart.sh uninstall   stop it and remove auto-start
#
# Optional login password: APP_PASSWORD='...' ./scripts/autostart.sh install
set -euo pipefail

LABEL="com.pokemon-tcg.assistant"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/pokemon-tcg-assistant.log"
DOMAIN="gui/$(id -u)"
NODE="$(command -v node || true)"

xml_escape() {
  local s=$1
  s=${s//&/&amp;}; s=${s//</&lt;}; s=${s//>/&gt;}
  printf '%s' "$s"
}

is_loaded() {
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1
}

build() {
  echo "==> 打包網頁"
  (cd "$PROJECT_DIR" && npm run build --workspace=frontend --silent)
}

wait_until_up() {
  for _ in $(seq 1 20); do
    if curl -fs http://127.0.0.1:3001/api/health >/dev/null; then
      echo "✅ 網站已在背景執行：http://127.0.0.1:3001"
      return 0
    fi
    sleep 1
  done
  echo "⚠️  網站沒有回應，請看 log：$0 logs" >&2
  return 1
}

install() {
  if [ -z "$NODE" ]; then
    echo "找不到 node，請先安裝 Node.js" >&2
    exit 1
  fi
  if curl -fs http://127.0.0.1:3001/api/health >/dev/null && ! is_loaded; then
    echo "3001 port 已經有網站在執行（可能是終端機裡的 npm start），請先按 Ctrl + C 停止它" >&2
    exit 1
  fi

  build

  local password_entry=""
  if [ -n "${APP_PASSWORD:-}" ]; then
    password_entry="<key>APP_PASSWORD</key><string>$(xml_escape "$APP_PASSWORD")</string>"
  fi

  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  # The plist may hold the login password, so only you can read it
  umask 077
  # caffeinate -s keeps the Mac awake while it runs, but only on AC power
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>$(xml_escape "$NODE")</string>
    <string>$(xml_escape "$PROJECT_DIR/backend/server.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$PROJECT_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$(dirname "$NODE")"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    $password_entry
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF

  if is_loaded; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    sleep 1
  fi
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "==> 已設定登入後自動啟動"
  wait_until_up
}

restart() {
  if ! is_loaded; then
    echo "還沒安裝自動啟動，請先執行：$0 install" >&2
    exit 1
  fi
  build
  launchctl kickstart -k "$DOMAIN/$LABEL"
  wait_until_up
}

status() {
  if is_loaded; then
    local pid
    pid=$(launchctl print "$DOMAIN/$LABEL" | awk '/^\tpid = / { print $3 }')
    echo "自動啟動：已安裝"
    echo "程序：${pid:-未執行（launchd 會自動重試）}"
  else
    echo "自動啟動：未安裝"
  fi
  if curl -fs http://127.0.0.1:3001/api/health >/dev/null; then
    echo "網站：執行中 http://127.0.0.1:3001"
  else
    echo "網站：沒有回應"
  fi
  echo "Log：$LOG"
}

logs() {
  touch "$LOG"
  tail -n 50 -f "$LOG"
}

uninstall() {
  if is_loaded; then
    launchctl bootout "$DOMAIN/$LABEL"
  fi
  rm -f "$PLIST"
  echo "✅ 已停止網站並移除自動啟動（log 保留在 $LOG）"
}

case "${1:-}" in
  install) install ;;
  restart) restart ;;
  status) status ;;
  logs) logs ;;
  uninstall) uninstall ;;
  *)
    cat <<EOF
用法：$0 <指令>

  install     打包網頁並設定登入後自動在背景執行
  restart     修改程式後重新打包並重新啟動
  status      查看是否在執行
  logs        查看 log（Ctrl + C 離開）
  uninstall   停止網站並移除自動啟動

要加登入密碼：APP_PASSWORD='你的密碼' $0 install
EOF
    exit 1
    ;;
esac
