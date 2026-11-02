const axios = require('axios');
const storage = require('./storage');

async function sendDiscordNotification(message, embeds = []) {
  const settings = await storage.getSettings();
  if (!settings.discordWebhook) return false;

  try {
    await axios.post(settings.discordWebhook, {
      username: 'Pokemon TCG 助手 🎴',
      avatar_url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
      content: message,
      embeds,
    });
    return true;
  } catch (e) {
    console.error('Discord notification failed:', e.message);
    return false;
  }
}

async function notifyNewProducts(products) {
  if (!products || products.length === 0) return;
  const settings = await storage.getSettings();
  if (!settings.notifyNewProducts) return;

  const embeds = products.slice(0, 5).map(p => ({
    title: p.name,
    description: p.description || '新商品上市！',
    color: 0xFFCC00,
    fields: [
      { name: '地區', value: regionLabel(p.region), inline: true },
      { name: '發售日', value: p.releaseDate || '待公佈', inline: true },
      { name: '類型', value: p.type || '補充包', inline: true },
    ],
    thumbnail: p.imageUrl ? { url: p.imageUrl } : undefined,
    url: p.url || undefined,
    footer: { text: 'Pokemon TCG 助手' },
    timestamp: new Date().toISOString(),
  }));

  await sendDiscordNotification(
    `🆕 **發現 ${products.length} 個新商品！**`,
    embeds
  );
}

async function notifyNewEvents(events) {
  if (!events || events.length === 0) return;
  const settings = await storage.getSettings();
  if (!settings.notifyEvents) return;

  const embeds = events.slice(0, 5).map(e => ({
    title: e.name,
    description: e.description || '新活動公告！',
    color: 0xFF6B6B,
    fields: [
      { name: '地區', value: regionLabel(e.region), inline: true },
      { name: '日期', value: e.date || '待公佈', inline: true },
      { name: '地點', value: e.location || '線上', inline: true },
    ],
    url: e.url || undefined,
    footer: { text: 'Pokemon TCG 助手' },
    timestamp: new Date().toISOString(),
  }));

  await sendDiscordNotification(
    `🎉 **發現 ${events.length} 個新活動！**`,
    embeds
  );
}

async function notifyNewTournaments(tournaments) {
  if (!tournaments || tournaments.length === 0) return;
  const settings = await storage.getSettings();
  if (!settings.notifyTournaments) return;

  const embeds = tournaments.slice(0, 5).map(t => ({
    title: t.name,
    description: t.description || '新比賽公告！',
    color: 0x4ECDC4,
    fields: [
      { name: '地區', value: regionLabel(t.region), inline: true },
      { name: '比賽日期', value: t.date || '待公佈', inline: true },
      { name: '報名截止', value: t.deadline || '待公佈', inline: true },
      { name: '地點', value: t.location || '待公佈', inline: true },
    ],
    url: t.registrationUrl || t.url || undefined,
    footer: { text: 'Pokemon TCG 助手' },
    timestamp: new Date().toISOString(),
  }));

  await sendDiscordNotification(
    `🏆 **發現 ${tournaments.length} 個新比賽！**`,
    embeds
  );
}

// Discord accepts at most 10 embeds per message
const MAX_EMBEDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateTime(value) {
  const d = new Date(value);
  if (isNaN(d)) return value || '待公佈';
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// Each tournament is reminded at most twice: when it enters the "N days before"
// window, and again in its last 24 hours. Sent reminders are recorded per
// tournament and deadline (a changed deadline is reminded again), and only
// after Discord accepted the message, so nothing is lost while no webhook is set.
async function notifyDeadlineReminders() {
  const settings = await storage.getSettings();
  if (!settings.notifyTournaments || !settings.discordWebhook) return;

  const [tournaments, sent] = await Promise.all([storage.getTournaments(), storage.getReminders()]);
  const now = Date.now();
  const daysThreshold = settings.notifyDaysBeforeDeadline || 3;

  const due = [];
  for (const t of tournaments) {
    if (!t.deadline) continue;
    const msLeft = new Date(t.deadline) - now;
    if (!(msLeft > 0 && msLeft <= daysThreshold * DAY_MS)) continue;
    const key = `${t.id}|${t.deadline}`;
    const stage = msLeft <= DAY_MS ? 'lastDay' : 'window';
    const record = sent[key] || {};
    // A tournament first seen in its last day only gets the last-day reminder
    if (record[stage] || (stage === 'window' && record.lastDay)) continue;
    due.push({ t, key, stage, msLeft });
  }

  // Forget reminders for deadlines that have passed
  const active = Object.fromEntries(Object.entries(sent).filter(([key]) => new Date(key.split('|').pop()) > now));

  if (due.length === 0) {
    if (Object.keys(active).length !== Object.keys(sent).length) await storage.saveReminders(active);
    return;
  }

  for (let i = 0; i < due.length; i += MAX_EMBEDS) {
    const batch = due.slice(i, i + MAX_EMBEDS);
    const embeds = batch.map(({ t, stage, msLeft }) => ({
      title: `⏰ ${t.name}`,
      description: stage === 'lastDay'
        ? `報名截止**不到 24 小時**！`
        : `報名截止還剩 **${Math.ceil(msLeft / DAY_MS)} 天**！`,
      color: stage === 'lastDay' ? 0xFF0000 : 0xFF8C00,
      fields: [
        { name: '截止時間', value: formatDateTime(t.deadline), inline: true },
        { name: '比賽日期', value: t.date ? formatDateTime(t.date) : '待公佈', inline: true },
        { name: '地點', value: t.location || '待公佈', inline: true },
      ],
      url: t.registrationUrl || t.url || undefined,
      footer: { text: 'Pokemon TCG 助手' },
      timestamp: new Date().toISOString(),
    }));

    const ok = await sendDiscordNotification(
      i === 0 ? `⚠️ **${due.length} 個比賽即將截止報名！**` : '',
      embeds
    );
    if (!ok) break;
    const at = new Date().toISOString();
    for (const { key, stage } of batch) active[key] = { ...active[key], [stage]: at };
  }

  await storage.saveReminders(active);
}

async function sendTestNotification() {
  return await sendDiscordNotification(
    '✅ **Pokemon TCG 助手通知測試成功！**\n您的 Discord Webhook 設定正確，將會收到即時的 TCG 資訊更新。',
    [{
      title: 'Pokemon TCG 助手',
      description: '我將會為您追蹤：\n🆕 新商品發售\n🎉 活動資訊\n🏆 比賽與報名截止',
      color: 0xFFCC00,
      footer: { text: '設定完成！' },
      timestamp: new Date().toISOString(),
    }]
  );
}

function regionLabel(region) {
  const map = { tw: '🇹🇼 台灣', jp: '🇯🇵 日本', us: '🇺🇸 美國' };
  return map[region] || region;
}

module.exports = {
  sendDiscordNotification,
  notifyNewProducts,
  notifyNewEvents,
  notifyNewTournaments,
  notifyDeadlineReminders,
  sendTestNotification,
};
