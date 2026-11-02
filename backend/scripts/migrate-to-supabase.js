// Copy the local JSON data (backend/data) into Supabase.
// Usage, with SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (see DEPLOY.md):
//   node --env-file=.env.local backend/scripts/migrate-to-supabase.js
// Existing rows in Supabase with the same name are overwritten.

const storage = require('../services/storage');

const DOCS = ['products', 'events', 'tournaments', 'lastFetch', 'inventory', 'watchlist', 'decks'];

async function main() {
  if (storage.driverName !== 'supabase') {
    console.error('找不到 SUPABASE_URL 或 SUPABASE_SECRET_KEY。請在 .env.local 填好這兩個值，並用 node --env-file=.env.local 執行（見 DEPLOY.md）');
    process.exit(1);
  }

  for (const doc of DOCS) {
    const value = await storage.fileDriver.read(doc, null);
    if (value === null) {
      console.log(`- ${doc}: 本機沒有資料，略過`);
      continue;
    }
    await storage.write(doc, value);
    const count = Array.isArray(value) ? `${value.length} 筆` : '已上傳';
    console.log(`✓ ${doc}: ${count}`);
  }
  // settings.json is skipped on purpose: set the Discord webhook and fee rate on the deployed site
  console.log('\n完成。設定（Discord Webhook、手續費率）請到網站的「設定」頁重新填寫。');
}

main().catch(e => {
  console.error('上傳失敗：', e.message);
  process.exit(1);
});
