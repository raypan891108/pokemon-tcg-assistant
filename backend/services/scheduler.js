const cron = require('node-cron');
const storage = require('./storage');
const notifier = require('./notifier');
const market = require('./market');
const twScraper = require('../scrapers/tw-scraper');
const jpScraper = require('../scrapers/jp-scraper');
const usScraper = require('../scrapers/us-scraper');

const SCRAPERS = { tw: twScraper, jp: jpScraper, us: usScraper };

let isRunning = false;
let scheduledJob = null;

async function fetchAll() {
  if (isRunning) {
    console.log('[Scheduler] Fetch already in progress, skipping...');
    return { success: false, reason: 'already_running' };
  }
  isRunning = true;
  try {
    return await runFetch();
  } finally {
    isRunning = false;
  }
}

async function runFetch() {
  const results = { products: [], events: [], tournaments: [], errors: [] };
  const fetched = [];

  console.log('[Scheduler] Starting data fetch...');
  const startTime = Date.now();

  const settings = await storage.getSettings();
  const regions = (settings.regions || ['tw', 'jp', 'us']).filter(r => SCRAPERS[r]);

  // Fetch from all regions in parallel
  const tasks = regions.flatMap(region => {
    const scraper = SCRAPERS[region];
    const label = region.toUpperCase();
    return [
      scraper.scrapeProducts().then(r => { results.products.push(...r); fetched.push(`${region}-products`); }).catch(e => results.errors.push(`${label} products: ${e.message}`)),
      scraper.scrapeEvents().then(r => { results.events.push(...r); }).catch(e => results.errors.push(`${label} events: ${e.message}`)),
      scraper.scrapeTournaments().then(r => { results.tournaments.push(...r); }).catch(e => results.errors.push(`${label} tournaments: ${e.message}`)),
    ];
  });

  await Promise.allSettled(tasks);

  // Save to storage and get newly added items
  const [newProducts, newEvents, newTournaments] = await Promise.all([
    storage.saveProducts(results.products),
    storage.saveEvents(results.events),
    storage.saveTournaments(results.tournaments),
    storage.updateLastFetch(fetched),
  ]);

  // Refresh 遊々亭 prices for watched cards
  try {
    const { errors } = await market.refreshWatchlist();
    results.errors.push(...errors.map(e => `Market: ${e}`));
  } catch (e) {
    results.errors.push(`Market: ${e.message}`);
  }

  // Send Discord notifications for new items
  await notifier.notifyNewProducts(newProducts);
  await notifier.notifyNewEvents(newEvents);
  await notifier.notifyNewTournaments(newTournaments);
  await notifier.notifyDeadlineReminders();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Scheduler] Fetch complete in ${elapsed}s — Products: ${newProducts.length} new, Events: ${newEvents.length} new, Tournaments: ${newTournaments.length} new`);
  if (results.errors.length > 0) {
    console.warn('[Scheduler] Errors:', results.errors);
  }

  return {
    success: true,
    elapsed,
    newProducts: newProducts.length,
    newEvents: newEvents.length,
    newTournaments: newTournaments.length,
    errors: results.errors,
  };
}

async function start() {
  const settings = await storage.getSettings();
  const hours = Math.min(Math.max(Number(settings.fetchIntervalHours) || 1, 1), 23);
  const cronExpr = `0 */${hours} * * *`;

  console.log(`[Scheduler] Starting with interval: every ${hours} hour(s)`);

  // Run immediately on start
  fetchAll().catch(e => console.error('[Scheduler] Initial fetch error:', e));

  // Schedule recurring fetches
  scheduledJob = cron.schedule(cronExpr, () => {
    fetchAll().catch(e => console.error('[Scheduler] Scheduled fetch error:', e));
  });

  return scheduledJob;
}

function stop() {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    console.log('[Scheduler] Stopped.');
  }
}

async function getStatus() {
  return {
    running: isRunning,
    scheduled: !!scheduledJob,
    lastFetch: await storage.getLastFetch(),
  };
}

module.exports = { start, stop, fetchAll, getStatus };
