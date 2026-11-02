# Pokemon TCG 助手

自動追蹤 Pokemon TCG 台灣、日本、美國三地的最新**商品**、**活動**與**比賽**資訊，管理卡拍拍賣場倉庫，並透過 Discord 推播通知。

網站跑在你自己的 Mac 上；用 [Tailscale](#用手機或其他電腦使用tailscale) 就能從手機或其他電腦連進來。

---

## 功能

- 📦 **新商品追蹤** — 補充包、構築組、特別組合等發售資訊
- 🎉 **活動資訊** — 各地 TCG 活動、展覽、特別賽事
- 🏆 **比賽資訊** — 賽事公告、報名連結、截止日期倒數
- 💹 **卡牌市場** — 查詢遊々亭日本單卡售價（自動換算台幣），追蹤卡片價格變化
- 🗃️ **賣場倉庫** — 記錄要在卡拍拍販售的卡片成本、上架價、成交價、手續費與運費，自動計算淨利，可匯出 CSV
- 🃏 **牌組推薦** — Limitless TCG 近 3 個月主流牌組排名與範例牌表（日本／亞洲賽制、國際賽制）
- 🔔 **Discord 通知** — 有新資料時自動推播到您的頻道

---

## 快速啟動

需要 Node.js 20 以上。

### 第一次：安裝套件

在專案資料夾執行：

```bash
npm install
```

### 平常使用

```bash
npm start
```

會先打包網頁再啟動網站，打開 **http://127.0.0.1:3001** 即可使用。啟動後會立刻抓一次資料，之後每小時自動更新。終端機視窗要保持開著，按 `Ctrl + C` 停止。

### 修改程式時（開發模式）

```bash
npm run dev
```

打開 **http://localhost:5173**，改程式碼會自動重新載入。

---

## 用手機或其他電腦使用（Tailscale）

Tailscale 會把你的 Mac 和手機連成一個私人網路。只有登入**你的 Tailscale 帳號**的裝置能連進來，網站不會公開到網路上，也會有 HTTPS。

> Mac 要開著、Tailscale 要連線、網站要在執行中，手機才連得到。

### 第一次設定

1. **Mac**：打開「應用程式」裡的 **Tailscale**，登入帳號（選單列會出現 Tailscale 圖示）。
2. **手機**：從 App Store 或 Google Play 安裝 **Tailscale**，用**同一個帳號**登入並連線。
3. **Mac**：在專案資料夾啟動網站：

   ```bash
   npm start
   ```

4. **Mac**：另開一個終端機視窗，讓 Tailscale 把網站分享到你的私人網路（只需要做一次）：

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3001
   ```

   - 第一次執行如果出現一個網址、說功能還沒開啟，用瀏覽器打開那個網址按啟用（會開啟 HTTPS 憑證），再執行一次同一個指令。
   - 成功後會顯示你的網址，例如 `https://your-mac.tail1234.ts.net`。

5. **手機**：確認 Tailscale 是連線狀態，用瀏覽器打開上一步的網址。可以「加入主畫面」當成 App 使用。

`--bg` 會讓分享設定一直保留，之後每次只要執行 `npm start` 就好。

### 讓 Mac 不要睡眠

Mac 睡眠時手機會連不到，自動更新也會暫停。啟動時改用下面這個指令，網站執行期間 Mac 就不會進入睡眠（螢幕還是可以關）：

```bash
caffeinate -i npm start
```

### 停止分享

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
```

### 密碼登入（選用）

透過 Tailscale 只有你自己的裝置能連進來，所以預設不需要密碼。如果 Tailscale 網路裡還有別人的裝置，可以加上登入密碼：

```bash
APP_PASSWORD='你的密碼' npm start
```

### 疑難排解

- **手機打不開網址**：確認手機 Tailscale 是連線狀態、Mac 上 `npm start` 還在執行。
- **`tailscale serve` 無法使用**：改用直接連線。用下面的指令啟動，再用手機打開 `http://<Mac 的 Tailscale IP>:3001`（IP 在 Tailscale App 裡，通常是 `100.` 開頭）。這樣同一個 Wi-Fi 的其他人也連得到，所以一定要設密碼：

  ```bash
  HOST=0.0.0.0 APP_PASSWORD='你的密碼' npm start
  ```

---

## 設定 Discord 通知

1. 在 Discord 頻道：**設定 → 整合 → Webhook → 新建 Webhook**
2. 複製 Webhook URL
3. 在網站的 **⚙️ 設定** 頁面貼上 URL
4. 點擊「測試通知」確認設定正確

---

## 資料儲存

資料都存在 `backend/data/`（JSON 格式）：

| 檔案 | 內容 | 放進 git |
|---|---|---|
| `inventory.json` | 賣場倉庫 | ✅ |
| `watchlist.json` | 卡牌市場追蹤清單與價格紀錄 | ✅ |
| `settings.json` | 使用者設定（含 Discord Webhook） | ❌ 避免外洩 |
| `products.json`、`events.json`、`tournaments.json`、`last_fetch.json`、`decks.json` | 抓取的資料與快取 | ❌ 每次會重新抓 |

倉庫紀錄只存在這台 Mac 上，新增或賣出卡片後建議 commit 一次當作備份：

```bash
git add backend/data && git commit -m "更新倉庫紀錄"
```

---

## 專案結構

```
backend/
  server.js        啟動網站與每小時排程
  app.js           API 路由
  services/        儲存、排程、通知、倉庫、卡價、牌組、登入
  scrapers/        各網站爬蟲（台灣、日本、美國、遊々亭、Limitless）
  data/            資料（JSON）
frontend/
  index.html
  src/pages/       各頁面
  vite.config.js   開發模式把 /api 轉給後端
```

---

## 資料來源

| 項目 | 網站 |
|------|------|
| 🇹🇼 台灣 | asia.pokemon-card.com/tw |
| 🇯🇵 日本 | pokemon-card.com |
| 🇺🇸 美國 | pokemon.com |
| 💹 卡價 | 遊々亭 yuyu-tei.jp |
| 🃏 牌組 | Limitless TCG limitlesstcg.com |
