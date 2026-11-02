const app = require('./app');
const auth = require('./services/auth');
const scheduler = require('./services/scheduler');

// Long-running server: serves the app and fetches data on a timer
const PORT = Number(process.env.PORT) || 3001;
// Only this Mac by default; other devices reach it through `tailscale serve` (see README)
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`\n🎴 Pokemon TCG 助手已啟動！`);
  console.log(`🌐 http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0' && !auth.enabled()) {
    console.log('⚠️  HOST=0.0.0.0 會讓同一個網路的其他人也能連線，建議設定 APP_PASSWORD');
  }
  console.log(auth.enabled() ? '🔒 已啟用密碼登入\n' : '');
  scheduler.start().catch(e => console.error('[Scheduler] Start error:', e));
});
