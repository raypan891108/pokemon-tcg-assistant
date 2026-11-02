-- Pokemon TCG 助手：Supabase 資料表
-- 在 Supabase 後台「SQL Editor」貼上並執行一次。

-- 每一份資料（商品、活動、倉庫、設定…）存成一列 JSON
create table if not exists public.tcg_store (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 開啟 RLS 且不建立任何 policy：瀏覽器用的公開金鑰（anon / publishable）完全讀不到，
-- 只有 Vercel 後端使用的 secret（service_role）金鑰可以存取。
alter table public.tcg_store enable row level security;
revoke all on public.tcg_store from anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 選用：每小時自動更新資料
-- Vercel 免費方案的排程一天只能跑一次。想要每小時更新，可以讓 Supabase 每小時呼叫網站。
-- 先把下面兩個值換成你的網址和 CRON_SECRET，再把這段取消註解後執行。
-- ─────────────────────────────────────────────────────────────
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'tcg-hourly-fetch',
--   '5 * * * *',
--   $$
--   select net.http_get(
--     url := 'https://你的網址.vercel.app/api/cron/fetch',
--     headers := jsonb_build_object('Authorization', 'Bearer 你的CRON_SECRET'),
--     timeout_milliseconds := 60000
--   );
--   $$
-- );
--
-- 停用每小時更新：select cron.unschedule('tcg-hourly-fetch');
