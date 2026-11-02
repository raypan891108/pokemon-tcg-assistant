# Pokemon TCG 助手

自動追蹤 Pokemon TCG 台灣、日本、美國三地的最新**商品**、**活動**與**比賽**資訊，並透過 Discord 推播通知。

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

### 1. 安裝依賴

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 啟動後端（API 伺服器）

```bash
cd backend
node server.js
```

後端啟動後會自動執行第一次資料抓取，之後每小時自動更新。

### 3. 啟動前端（Dashboard）

```bash
cd frontend
npm run dev
```

開啟瀏覽器訪問 **http://localhost:5173**

---

## 部署到雲端

要讓手機或其他電腦也能使用，請參考 [DEPLOY.md](DEPLOY.md)，部署到 Vercel + Supabase（含密碼登入與 HTTPS）。

---

## 設定 Discord 通知

1. 在 Discord 頻道：**設定 → 整合 → Webhook → 新建 Webhook**
2. 複製 Webhook URL
3. 在 Dashboard 的 **⚙️ 設定** 頁面貼上 URL
4. 點擊「測試通知」確認設定正確

---

## 資料儲存

資料儲存在 `backend/data/` 資料夾（JSON 格式）：
- `products.json` — 商品資料
- `events.json` — 活動資料
- `tournaments.json` — 比賽資料
- `inventory.json` — 賣場倉庫
- `watchlist.json` — 卡牌市場追蹤清單與價格紀錄
- `decks.json` — 牌組推薦快取
- `settings.json` — 使用者設定

部署到 Vercel 時，這些資料改存在 Supabase 的 `tcg_store` 資料表。

---

## 資料來源

| 地區 | 網站 |
|------|------|
| 🇹🇼 台灣 | asia.pokemon-card.com/tw |
| 🇯🇵 日本 | pokemon-card.com |
| 🇺🇸 美國 | pokemon.com |
| 💹 卡價 | 遊々亭 yuyu-tei.jp |
| 🃏 牌組 | Limitless TCG limitlesstcg.com |
