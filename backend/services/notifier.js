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

async function notifyDeadlineReminders() {
  const settings = await storage.getSettings();
  if (!settings.notifyTournaments) return;

  const tournaments = await storage.getTournaments();
  const now = new Date();
  const daysThreshold = settings.notifyDaysBeforeDeadline || 3;

  const upcoming = tournaments.filter(t => {
    if (!t.deadline) return false;
    const deadline = new Date(t.deadline);
    const daysLeft = (deadline - now) / (1000 * 60 * 60 * 24);
    return daysLeft > 0 && daysLeft <= daysThreshold;
  });

  if (upcoming.length === 0) return;

  const embeds = upcoming.map(t => {
    const deadline = new Date(t.deadline);
    const daysLeft = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
    return {
      title: `⏰ ${t.name}`,
      description: `報名截止還剩 **${daysLeft} 天**！`,
      color: daysLeft <= 1 ? 0xFF0000 : 0xFF8C00,
      fields: [
        { name: '截止日期', value: t.deadline, inline: true },
        { name: '比賽日期', value: t.date || '待公佈', inline: true },
        { name: '地點', value: t.location || '待公佈', inline: true },
      ],
      url: t.registrationUrl || t.url || undefined,
      footer: { text: 'Pokemon TCG 助手' },
      timestamp: new Date().toISOString(),
    };
  });

  await sendDiscordNotification(
    `⚠️ **${upcoming.length} 個比賽即將截止報名！**`,
    embeds
  );
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
