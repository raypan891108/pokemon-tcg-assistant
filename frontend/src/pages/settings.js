import { api } from '../api.js';
import { showToast, escHtml } from '../utils.js';

export async function renderSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">⚙️ 設定</h1>
        <p class="page-subtitle">自訂通知與資料抓取設定</p>
      </div>
    </div>
    <div class="page-body">
      <div id="settings-content">
        <div class="loading-spinner"><div class="spinner"></div><span>載入設定...</span></div>
      </div>
    </div>`;

  try {
    const settings = await api.settings();
    renderSettingsForm(settings);
  } catch (e) {
    document.getElementById('settings-content').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">無法載入設定</div></div>`;
  }
}

function renderSettingsForm(settings) {
  document.getElementById('settings-content').innerHTML = `
    <!-- Discord Notification -->
    <div class="settings-section">
      <div class="settings-title">🔔 Discord 通知設定</div>
      <div class="form-group">
        <label class="form-label" for="discord-webhook">Discord Webhook URL</label>
        <input type="url" id="discord-webhook" class="form-input"
          placeholder="https://discord.com/api/webhooks/..."
          value="${escHtml(settings.discordWebhook || '')}" />
        <div class="form-hint">
          在 Discord 頻道設定 → 整合 → Webhook → 新建 Webhook，複製連結貼上即可
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn-primary" id="btn-save-webhook" style="flex:1">💾 儲存 Webhook</button>
        <button class="btn-secondary" id="btn-test-notify">🔔 測試通知</button>
      </div>
    </div>

    <!-- Notification Toggles -->
    <div class="settings-section">
      <div class="settings-title">📋 通知項目</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">新商品發售通知</div>
          <div class="toggle-desc">有新的補充包、構築組等商品時通知，並在發售前提醒</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-products" ${settings.notifyNewProducts ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">活動資訊通知</div>
          <div class="toggle-desc">當有新的 TCG 活動或展覽時通知</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-events" ${settings.notifyEvents ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">比賽報名通知</div>
          <div class="toggle-desc">當有新的比賽公告或報名截止前提醒</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-tournaments" ${settings.notifyTournaments ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Region Settings -->
    <div class="settings-section">
      <div class="settings-title">🌏 追蹤地區</div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">🇹🇼 台灣</div>
          <div class="toggle-desc">pokemon.com.tw 活動與商品</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-tw" ${(settings.regions || []).includes('tw') ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">🇯🇵 日本</div>
          <div class="toggle-desc">pokemon-card.com 最新情報</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-jp" ${(settings.regions || []).includes('jp') ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">🇺🇸 美國</div>
          <div class="toggle-desc">pokemon.com Play! Pokemon 賽事</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-us" ${(settings.regions || []).includes('us') ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Fetch Interval -->
    <div class="settings-section">
      <div class="settings-title">⏱️ 更新設定</div>
      <div class="form-group">
        <label class="form-label" for="fetch-interval">自動更新間隔（小時）</label>
        <input type="number" id="fetch-interval" class="form-input" min="1" max="24"
          value="${settings.fetchIntervalHours || 1}" style="max-width:120px">
        <div class="form-hint">建議 1-6 小時，過於頻繁可能被網站封鎖。修改後需重新啟動後端才會生效</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="deadline-days">報名截止前幾天提醒</label>
        <input type="number" id="deadline-days" class="form-input" min="1" max="14"
          value="${settings.notifyDaysBeforeDeadline || 3}" style="max-width:120px">
      </div>
      <div class="form-group">
        <label class="form-label" for="release-days">新商品發售前幾天提醒</label>
        <input type="number" id="release-days" class="form-input" min="1" max="14"
          value="${settings.notifyDaysBeforeRelease || 3}" style="max-width:120px">
        <div class="form-hint">發售前和發售當天各用 Discord 提醒一次（只在早上 8 點到晚上 10 點之間發送）</div>
      </div>
      <button class="btn-primary" id="btn-save-all" style="max-width:200px">💾 儲存所有設定</button>
    </div>

    <!-- Seller settings -->
    <div class="settings-section">
      <div class="settings-title">🗃️ 賣場設定</div>
      <div class="form-group">
        <label class="form-label" for="fee-rate">卡拍拍手續費率（%）</label>
        <input type="number" id="fee-rate" class="form-input" min="0" max="100" step="0.1"
          value="${settings.kapaipaiFeeRate ?? 0}" style="max-width:120px">
        <div class="form-hint">記錄成交時若沒填手續費，會用「成交總額 × 費率」自動計算。請依卡拍拍實際收費填寫</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="jpy-rate">備用日幣匯率（1 円 = NT$）</label>
        <input type="number" id="jpy-rate" class="form-input" min="0" step="0.0001"
          value="${settings.jpyToTwd ?? 0.21}" style="max-width:120px">
        <div class="form-hint">平常會自動抓即時匯率，抓不到時才用這個數字</div>
      </div>
      <button class="btn-primary" id="btn-save-seller" style="max-width:200px">💾 儲存賣場設定</button>
    </div>

    <!-- Calendar subscription -->
    <div class="settings-section">
      <div class="settings-title">📅 行事曆訂閱</div>
      <div class="form-hint" style="margin-bottom:12px">把比賽日期、報名截止時間和新商品發售日加到手機的「行事曆」App，資料每小時自動更新，截止和發售前會跳出提醒</div>
      <div id="calendar-section" class="text-sm">載入中...</div>
    </div>

    <!-- Backups -->
    <div class="settings-section">
      <div class="settings-title">💾 自動備份</div>
      <div class="form-hint" style="margin-bottom:12px">每天自動把賣場倉庫、追蹤清單和設定複製一份，保留最近 30 天</div>
      <div id="backup-status" class="text-sm" style="margin-bottom:12px;line-height:1.7">載入中...</div>
      <button class="btn-secondary" id="btn-backup-now">💾 立即備份</button>
    </div>

    <!-- Account (only when the server requires a password) -->
    <div class="settings-section" id="account-section" hidden>
      <div class="settings-title">🔒 帳號</div>
      <button class="btn-secondary" id="btn-logout">登出</button>
    </div>

    <!-- Info Box -->
    <div class="settings-section" style="border-color:rgba(255,215,0,0.2);background:rgba(255,215,0,0.04)">
      <div class="settings-title">💡 使用說明</div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--text-secondary)">
        <div>📌 資料會自動定時更新，您也可以點擊側欄「立即更新」手動觸發</div>
        <div>📌 Discord 通知設定完成後，有新資料時會自動推播到您的頻道</div>
        <div>📌 程式運行在您的本機端，資料儲存在 <code style="background:var(--bg-elevated);padding:2px 6px;border-radius:4px">backend/data/</code> 資料夾</div>
      </div>
    </div>`;

  // Save webhook
  document.getElementById('btn-save-webhook').addEventListener('click', async () => {
    const webhook = document.getElementById('discord-webhook').value.trim();
    await saveSettings({ discordWebhook: webhook });
  });

  // Test notification
  document.getElementById('btn-test-notify').addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-notify');
    btn.disabled = true;
    btn.textContent = '發送中...';
    try {
      const result = await api.testNotify();
      if (result.success) {
        showToast('測試通知發送成功！請檢查您的 Discord 頻道', 'success');
      } else {
        showToast('發送失敗，請確認 Webhook URL 是否正確', 'error');
      }
    } catch (e) {
      showToast('無法連接到後端服務', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔔 測試通知';
    }
  });

  api.calendarInfo().then(({ path }) => {
    const el = document.getElementById('calendar-section');
    const url = `${window.location.origin}${path}`;
    // A phone can't reach this Mac's own address; it needs the Tailscale URL
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    el.innerHTML = `
      ${local ? '<div class="form-hint" style="margin-bottom:10px;color:var(--gold)">⚠️ 你現在是用 Mac 本機網址開啟，手機連不到。請用手機打開網站的 Tailscale 網址，再到這裡按「加入 iPhone 行事曆」。</div>' : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <a class="btn-primary" style="flex:none" href="${escHtml(url.replace(/^https?:/, 'webcal:'))}">📲 加入 iPhone 行事曆</a>
        <button class="btn-secondary" type="button" id="btn-copy-calendar">📋 複製訂閱網址</button>
        <a class="btn-secondary" href="${escHtml(path)}" download="pokemon-tcg.ics">⬇ 下載 .ics</a>
      </div>
      <div class="form-hint">按「加入 iPhone 行事曆」後選「訂閱」。手機上的 Tailscale 要保持連線，行事曆才會更新。Google 日曆可用「複製訂閱網址」→「透過網址新增日曆」，但 Google 的伺服器連不到 Tailscale 網址，所以只適用 iPhone／Mac 的行事曆。</div>`;
    el.querySelector('#btn-copy-calendar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast('已複製訂閱網址', 'success');
      } catch {
        window.prompt('複製這個網址：', url);
      }
    });
  }).catch(e => {
    document.getElementById('calendar-section').textContent = `無法讀取行事曆網址：${e.message}`;
  });

  const showBackupStatus = async () => {
    const el = document.getElementById('backup-status');
    try {
      const s = await api.backupStatus();
      // Show the iCloud Drive folder the way Finder names it
      s.dir = s.dir.replace(/^.*\/com~apple~CloudDocs/, 'iCloud 雲碟');
      el.innerHTML = s.latest
        ? `上次備份：<strong>${new Date(s.latestAt || s.latest).toLocaleString('zh-TW')}</strong>（共 ${s.count} 份）<br><span class="text-muted">位置：${escHtml(s.dir)}</span>`
        : `還沒有備份，下次自動更新時會建立第一份<br><span class="text-muted">位置：${escHtml(s.dir)}</span>`;
    } catch (e) {
      el.textContent = `無法讀取備份狀態：${e.message}`;
    }
  };
  showBackupStatus();

  document.getElementById('btn-backup-now').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { files } = await api.backupNow();
      showToast(`已備份 ${files.length} 個檔案`, 'success');
      await showBackupStatus();
    } catch (err) {
      showToast(`備份失敗：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  api.authStatus().then(({ required }) => {
    document.getElementById('account-section').hidden = !required;
  }).catch(() => {});

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api.logout();
    window.location.reload();
  });

  document.getElementById('btn-save-seller').addEventListener('click', async () => {
    const feeRate = parseFloat(document.getElementById('fee-rate').value);
    const jpyRate = parseFloat(document.getElementById('jpy-rate').value);
    await saveSettings({
      kapaipaiFeeRate: Number.isFinite(feeRate) && feeRate >= 0 ? feeRate : 0,
      jpyToTwd: Number.isFinite(jpyRate) && jpyRate > 0 ? jpyRate : 0.21,
    });
  });

  // Save all settings
  document.getElementById('btn-save-all').addEventListener('click', async () => {
    const regions = ['tw', 'jp', 'us'].filter(r => document.getElementById(`toggle-${r}`).checked);
    await saveSettings({
      discordWebhook: document.getElementById('discord-webhook').value.trim(),
      notifyNewProducts: document.getElementById('toggle-products').checked,
      notifyEvents: document.getElementById('toggle-events').checked,
      notifyTournaments: document.getElementById('toggle-tournaments').checked,
      regions,
      fetchIntervalHours: parseInt(document.getElementById('fetch-interval').value) || 1,
      notifyDaysBeforeDeadline: parseInt(document.getElementById('deadline-days').value) || 3,
      notifyDaysBeforeRelease: parseInt(document.getElementById('release-days').value) || 3,
    });
  });
}

async function saveSettings(partial) {
  try {
    const current = await api.settings();
    await api.saveSettings({ ...current, ...partial });
    showToast('設定已儲存！', 'success');
  } catch (e) {
    showToast('儲存失敗，請確認後端已啟動', 'error');
  }
}
