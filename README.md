# Pokemon TCG 助手

自動追蹤 Pokemon TCG 台灣、日本、美國三地的最新**商品**、**活動**與**比賽**資訊，管理卡拍拍賣場倉庫，並透過 Discord 推播通知。

網站跑在你自己的 Mac 或 Windows 電腦上；用 [Tailscale](#用手機或其他電腦使用tailscale) 就能從手機或其他電腦連進來。

---

## 功能

- 📦 **新商品追蹤** — 補充包、構築組、特別組合等發售資訊
- 🎉 **活動資訊** — 各地 TCG 活動、展覽、特別賽事
- 🏆 **比賽資訊** — 賽事公告、報名連結、截止日期倒數；台灣的比賽會標在互動地圖上，點地標就能看那個場地的比賽和報名連結
- 📅 **行事曆訂閱** — 比賽、報名截止、新商品發售日同步到 iPhone 行事曆，到時間會跳提醒（設定頁 › 行事曆訂閱）
- 💹 **卡牌市場** — 查詢遊々亭日本單卡售價（自動換算台幣；可輸入日文卡名、158/103 或 M6a_158），追蹤卡片價格走勢，設定「低於／高於」價格提醒
- 🗃️ **賣場倉庫** — 記錄要在卡拍拍販售的卡片成本、上架價、成交價、手續費與運費，自動計算淨利，可匯出 CSV
- 🃏 **牌組推薦** — Limitless TCG 近 3 個月主流牌組排名與範例牌表（日本／亞洲賽制、國際賽制），卡名可切換中文／日文／英文
- 🔗 **相關網站** — 把常用的 PTCG 網站分組整理在一頁，可以自己新增、修改、排序
- 🔔 **Discord 通知** — 新資料、報名截止、新商品發售（前幾天與當天）、卡價提醒，自動推播到您的頻道

---

## 快速啟動

需要 Node.js 22.12 以上，建議使用 [nodejs.org](https://nodejs.org) 上標示 LTS 的版本。升級 Node.js 後要再執行一次 `npm install` 和 `./scripts/autostart.sh install`。

### 第一次：安裝套件

在專案資料夾執行：

```bash
npm install
```

### 平常使用：在背景自動執行（建議）

```bash
./scripts/autostart.sh install
```

網站會在背景執行，打開 **http://127.0.0.1:3001** 即可使用：

- Mac 登入後自動啟動，關掉終端機也不會停。
- 網站當掉時會在幾秒內自動重新啟動。
- 接著電源時 Mac 不會睡眠；用電池時照常睡眠，不會耗電。

| 指令 | 用途 |
|---|---|
| `./scripts/autostart.sh status` | 查看是否在執行 |
| `./scripts/autostart.sh logs` | 查看 log（`Ctrl + C` 離開） |
| `./scripts/autostart.sh restart` | **修改程式後**重新打包並重新啟動 |
| `./scripts/autostart.sh password` | 設定、修改或取消登入密碼 |
| `./scripts/autostart.sh uninstall` | 停止網站並取消自動啟動 |

Log 存在 `~/Library/Logs/pokemon-tcg-assistant.log`。

### Windows：在背景自動執行

在 PowerShell 或命令提示字元裡，於專案資料夾執行：

```bash
scripts\autostart install
```

指令和 Mac 一樣（`status`、`logs`、`restart`、`password`、`uninstall`），只是把 `./scripts/autostart.sh` 換成 `scripts\autostart`：

- 用「工作排程器」設定登入 Windows 後自動啟動，不會開視窗，關掉終端機也不會停。
- 網站當掉時會在 10 秒內自動重新啟動。
- 接著電源時電腦不會睡眠；用電池時照常睡眠。
- 密碼存在 `%LOCALAPPDATA%\pokemon-tcg-assistant\config.json`，Log 存在同一個資料夾的 `pokemon-tcg-assistant.log`。

### 手動執行

不想在背景執行時，也可以在終端機執行（視窗要保持開著，按 `Ctrl + C` 停止）：

```bash
npm start
```

已經設定背景執行的話，兩者會搶同一個 port，請先執行 `./scripts/autostart.sh uninstall`。

---

## 自動更新資料

- 網站啟動時會立刻抓一次資料，之後**每小時整點**自動重新抓取，和既有資料比對，有新的商品、活動、比賽就加入。
- 側欄會顯示「上次更新」和「下次更新」的時間。
- 網頁開著時，若自動更新找到新資料，會跳出「自動更新發現 N 筆新資料」的提示，並更新側欄的數字。
- 有設定 Discord Webhook 的話，新資料也會推播到 Discord。
- 追蹤清單裡的卡片價格也會在每次更新時重新抓取。
- 想改間隔：到「設定」頁修改「自動更新間隔」，再執行 `./scripts/autostart.sh restart`。
- Mac 睡眠時不會更新，醒來後會在下一個整點繼續。

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
3. **Mac**：確認網站在執行。還沒設定背景執行的話，先執行：

   ```bash
   ./scripts/autostart.sh install
   ```

4. **Mac**：讓 Tailscale 把網站分享到你的私人網路（只需要做一次）：

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 3001
   ```

   Windows 上是 `tailscale serve --bg 3001`（停止分享：`tailscale serve reset`）。

   - 第一次執行如果出現一個網址、說功能還沒開啟，用瀏覽器打開那個網址按啟用（會開啟 HTTPS 憑證），再執行一次同一個指令。
   - 成功後會顯示你的網址，例如 `https://your-mac.tail1234.ts.net`。

5. **手機**：確認 Tailscale 是連線狀態，用瀏覽器打開上一步的網址。可以「加入主畫面」當成 App 使用。

`--bg` 會讓分享設定一直保留；搭配背景執行，之後什麼都不用做，Mac 開著手機就能連。

### 讓 Mac 不要睡眠

Mac 睡眠時手機會連不到，自動更新也會暫停。

- 用背景執行時，**接著電源**就不會睡眠（螢幕還是可以關）。
- 闔上筆電螢幕還是會睡眠，除非有接外接螢幕。
- 手動執行時，可以改用下面的指令讓 Mac 保持清醒：

```bash
caffeinate -i npm start
```

### 停止分享

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
```

### 密碼登入（選用）

透過 Tailscale 只有你 Tailscale 網路裡的裝置能連進來，所以預設不需要密碼。如果 Tailscale 網路裡還有別人的裝置，請加上登入密碼：

```bash
./scripts/autostart.sh password
```

- 會請你輸入兩次密碼（輸入時不會顯示，也不會留在終端機的指令紀錄裡），至少 8 個字元。
- 密碼只存在你自己才能讀的背景服務設定檔裡；之後重新執行 `install` 也會保留。
- 修改密碼會讓所有裝置登出，重新登入一次即可。
- 想取消密碼：執行同一個指令，直接按 Enter 再輸入 `y`。
- 用 `./scripts/autostart.sh status` 可以看到目前有沒有設定密碼。

### 疑難排解

- **手機打不開網址**：確認手機 Tailscale 是連線狀態，並在 Mac 上執行 `./scripts/autostart.sh status` 確認網站在執行。
- **網址出現 502**：網站沒有在執行，執行 `./scripts/autostart.sh install` 或 `npm start`。
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

| 檔案 | 內容 |
|---|---|
| `inventory.json` | 賣場倉庫（成本、成交價） |
| `watchlist.json` | 卡牌市場追蹤清單與價格紀錄 |
| `settings.json` | 使用者設定（含 Discord Webhook） |
| `links.json` | 相關網站清單與分組 |
| `products.json`、`events.json`、`tournaments.json`、`last_fetch.json`、`decks.json` | 抓取的資料與快取，每次會重新抓 |
| `geocode.json` | 比賽場地的地圖座標（從 OpenStreetMap 查到的，查過的地址不會再查） |

這個 repo 是公開的，所以 `backend/data/` 裡的檔案**都不會放進 git**。

### 自動備份

網站每天會自動把 `inventory.json`、`watchlist.json`、`links.json`、`settings.json` 複製一份到 **iCloud 雲碟 › TCG助手備份**，每天一個以日期命名的資料夾（例如 `2026-11-02`），保留最近 30 天。沒有開 iCloud 雲碟時，會改存到「文件」資料夾。Windows 上則存到 **OneDrive › TCG助手備份**（沒有 OneDrive 時同樣存到「文件」）。

- 「⚙️ 設定」頁可以看到上次備份的時間，也可以按「💾 立即備份」。
- 要還原時，把備份資料夾裡的檔案複製回 `backend/data/`，再執行 `./scripts/autostart.sh restart`。
- 另外也可以在「賣場倉庫」頁按「⬇ 匯出 CSV」，用 Excel 開啟。

### 換電腦（例如從 Mac 搬到 Windows）

`backend/data/` 不在 git 裡，clone 下來是空的。把舊電腦的 `inventory.json`、`watchlist.json`、`links.json`、`settings.json`（或最新一份備份資料夾裡的同名檔案）複製到新電腦的 `backend/data/`，再執行 `install`（已在執行的話用 `restart`）。登入密碼不在這些檔案裡，要在新電腦重新設定一次。

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
scripts/
  autostart.sh     設定 Mac 背景自動執行（launchd）
  autostart.cmd    設定 Windows 背景自動執行（工作排程器；執行 autostart.ps1）
  windows-service.js  Windows 背景執行時啟動網站、當掉重啟、寫 log
```

---

## 資料來源

| 項目 | 網站 |
|------|------|
| 🇹🇼 台灣 | asia.pokemon-card.com/tw |
| 🇯🇵 日本 | pokemon-card.com（比賽頁有機器人防護，目前抓不到；商品和活動正常） |
| 🇺🇸 美國 | pokemon.com（官網的機器人防護擋掉了程式抓取，預設關閉，可在「設定」開啟） |
| 💹 卡價 | 遊々亭 yuyu-tei.jp |
| 🃏 牌組 | Limitless TCG limitlesstcg.com |
| 🗺️ 地圖 | OpenStreetMap（底圖與地址定位） |
