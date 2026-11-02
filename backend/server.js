const app = require('./app');
const auth = require('./services/auth');
const storage = require('./services/storage');
const scheduler = require('./services/scheduler');

// Long-running server for local use: serves the app and fetches data on a timer
const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`\n🎴 Pokemon TCG 助手後端已啟動！`);
  console.log(`📡 API: http://localhost:${PORT}/api/health`);
  console.log(`💾 資料儲存：${storage.driverName === 'supabase' ? 'Supabase' : '本機 JSON 檔'}`);
  console.log(auth.enabled() ? '🔒 已啟用密碼登入\n' : '⚠️  未設定 APP_PASSWORD，任何人都能存取（僅適合本機使用）\n');
  scheduler.start().catch(e => console.error('[Scheduler] Start error:', e));
});
