# 部署到 Vercel + Supabase

網頁和 API 放在 **Vercel**，資料存在 **Supabase**（跟 AI office 一樣的 Supabase），手機或任何電腦都能用 `https://xxx.vercel.app` 登入。

```
瀏覽器 ──HTTPS──▶ Vercel（網頁 CDN + /api 函式，東京機房）──▶ Supabase（tcg_store 資料表）
                         ▲
        每天 Vercel Cron／每小時 Supabase pg_cron 呼叫 /api/cron/fetch 抓新資料
```

- 網站有**密碼登入**，沒登入看不到任何資料。
- 本機開發完全不受影響：沒設定 Supabase 時，資料照樣存在 `backend/data/` 的 JSON 檔。

> ⚠️ **Vercel 免費（Hobby）方案的條款限「個人、非商業用途」。** 這個網站有用來管理賣場的倉庫功能，是否算商業用途請自行判斷；若有疑慮可升級 Pro 方案（每月 US$20）。

---

## 1. 建立 Supabase 專案（只需一次）

1. 到 <https://supabase.com/dashboard> 按 **New project**。
   - 建議**另開一個新專案**，不要跟 AI office 共用，資料和金鑰才會分開（免費方案可以有 2 個專案）。
   - Region 選 **Northeast Asia (Tokyo)**，跟 Vercel 函式同一區比較快。
2. 左側 **SQL Editor** → 貼上 [`supabase/schema.sql`](supabase/schema.sql) 的內容 → **Run**，會建立 `tcg_store` 資料表。
3. 左側 **Project Settings → API Keys**，記下兩個值：
   - **Project URL**（`https://xxxx.supabase.co`）
   - **Secret key**（`sb_secret_...`；舊專案則是 `service_role` key）

> 🔑 Secret key 可以讀寫所有資料，**只能放在 Vercel 的環境變數**，不要貼到網頁、聊天或 commit 進 git。

## 2. 部署到 Vercel（只需一次）

在 Mac 的專案資料夾執行，依畫面指示登入 Vercel：

```bash
npx vercel login
```

建立並連結 Vercel 專案（問題都可以用預設值，設定會從 `vercel.json` 讀取）：

```bash
npx vercel link
```

設定 4 個環境變數。每一行執行後會**提示你輸入值**（輸入的值不會留在指令紀錄裡）：

```bash
npx vercel env add SUPABASE_URL production
```

```bash
npx vercel env add SUPABASE_SECRET_KEY production
```

```bash
npx vercel env add APP_PASSWORD production
```

```bash
npx vercel env add CRON_SECRET production
```

| 變數 | 填什麼 |
|---|---|
| `SUPABASE_URL` | 第 1 步的 Project URL |
| `SUPABASE_SECRET_KEY` | 第 1 步的 Secret key |
| `APP_PASSWORD` | 網站登入密碼，至少 12 個字元 |
| `CRON_SECRET` | 一串隨機字，可用 `openssl rand -hex 32` 產生；排程呼叫網站時用來驗證身分 |

正式部署：

```bash
npx vercel --prod
```

完成後會顯示網址，打開並用 `APP_PASSWORD` 登入。第一次資料是空的，按側欄「立即更新」抓一次資料。

## 3. 把 Mac 上的資料搬上去（選用）

本機的倉庫紀錄、追蹤清單等可以上傳到 Supabase。在專案資料夾建立 `.env.local` 檔（已被 git 忽略），內容兩行：

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

然後執行：

```bash
node --env-file=.env.local backend/scripts/migrate-to-supabase.js
```

⚠️ 會覆蓋 Supabase 上的同名資料。設定（Discord Webhook、手續費率）不會上傳，請到網站的「設定」頁重新填寫。

## 4. 每小時自動更新（選用，建議）

Vercel 免費方案的排程**一天只跑一次**（台灣時間早上 8 點左右）。要每小時更新：

1. 打開 [`supabase/schema.sql`](supabase/schema.sql) 最下面的「每小時自動更新」那段。
2. 把 `https://你的網址.vercel.app` 和 `你的CRON_SECRET` 換成實際的值，取消註解。
3. 貼到 Supabase 的 **SQL Editor** 執行。

這樣 Supabase 每小時第 5 分鐘會呼叫網站抓資料，也能避免 Supabase 免費專案因 7 天沒活動而被暫停。

---

## 日常操作

### 更新網站
修改程式後（建議先 commit）：

```bash
npx vercel --prod
```

### 查看 log
Vercel 後台 → 你的專案 → **Logs**。也可以先列出部署：

```bash
npx vercel ls
```

### 備份資料
Supabase 後台 → **Table Editor** → `tcg_store` → 右上角 **Export → CSV**。倉庫紀錄只存在 Supabase，建議定期備份。

### 修改登入密碼
Vercel 後台 → 專案 → **Settings → Environment Variables** 修改 `APP_PASSWORD`，再執行一次 `npx vercel --prod`。改密碼會讓所有裝置登出。

### 本機連 Supabase 測試
有了第 3 步的 `.env.local`，本機後端也可以直接讀寫雲端資料：

```bash
node --env-file=.env.local backend/server.js
```

---

## 注意事項

- **Discord Webhook 要在雲端網站的「設定」頁重新填一次**。
- 「設定」頁的「自動更新間隔」只在本機執行時有效；雲端的更新頻率由 Vercel Cron 和第 4 步的 pg_cron 決定。
- 每次抓資料最多 60 秒（Vercel 函式上限）。追蹤清單的卡片很多時，會先更新最久沒更新的卡，剩下的留到下一次。
- 雲端主機的 IP 可能被部分網站擋下。部署後請在 Vercel Logs 確認各爬蟲是否正常。
- 登入失敗次數限制是記在函式記憶體裡，在 Vercel 上保護力較弱，所以密碼請設長一點。
