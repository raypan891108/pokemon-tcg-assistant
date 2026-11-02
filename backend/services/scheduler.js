const cron = require('node-cron');
const storage = require('./storage');
const notifier = require('./notifier');
const market = require('./market');
const twScraper = require('../scrapers/tw-scraper');
const jpScraper = require('../scrapers/jp-scraper');
const usScraper = require('../scrapers/us-scraper');

let isRunning = false;
let scheduledJob = null;

async function fetchAll() {
  if (isRunning) {
    console.log('[Scheduler] Fetch already in progress, skipping...');
    return { success: false, reason: 'already_running' };
  }
  isRunning = true;
  const results = { products: [], events: [], tournaments: [], errors: [] };

  console.log('[Scheduler] Starting data fetch...');
  const startTime = Date.now();

  const settings = storage.getSettings();
  const regions = settings.regions || ['tw', 'jp', 'us'];

  // Fetch from all regions in parallel
  const tasks = [];

  if (regions.includes('tw')) {
    tasks.push(
      twScraper.scrapeProducts().then(r => { results.products.push(...r); storage.updateLastFetch('tw-products'); }).catch(e => results.errors.push(`TW products: ${e.message}`)),
      twScraper.scrapeEvents().then(r => { results.events.push(...r); }).catch(e => results.errors.push(`TW events: ${e.message}`)),
      twScraper.scrapeTournaments().then(r => { results.tournaments.push(...r); }).catch(e => results.errors.push(`TW tournaments: ${e.message}`)),
    );
  }

  if (regions.includes('jp')) {
    tasks.push(
      jpScraper.scrapeProducts().then(r => { results.products.push(...r); storage.updateLastFetch('jp-products'); }).catch(e => results.errors.push(`JP products: ${e.message}`)),
      jpScraper.scrapeEvents().then(r => { results.events.push(...r); }).catch(e => results.errors.push(`JP events: ${e.message}`)),
      jpScraper.scrapeTournaments().then(r => { results.tournaments.push(...r); }).catch(e => results.errors.push(`JP tournaments: ${e.message}`)),
    );
  }

  if (regions.includes('us')) {
    tasks.push(
      usScraper.scrapeProducts().then(r => { results.products.push(...r); storage.updateLastFetch('us-products'); }).catch(e => results.errors.push(`US products: ${e.message}`)),
      usScraper.scrapeEvents().then(r => { results.events.push(...r); }).catch(e => results.errors.push(`US events: ${e.message}`)),
      usScraper.scrapeTournaments().then(r => { results.tournaments.push(...r); }).catch(e => results.errors.push(`US tournaments: ${e.message}`)),
    );
  }

  await Promise.allSettled(tasks);

  // Save to storage and get newly added items
  const newProducts = storage.saveProducts(results.products);
  const newEvents = storage.saveEvents(results.events);
  const newTournaments = storage.saveTournaments(results.tournaments);

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

  isRunning = false;
  return {
    success: true,
    elapsed,
    newProducts: newProducts.length,
    newEvents: newEvents.length,
    newTournaments: newTournaments.length,
    errors: results.errors,
  };
}

function start() {
  const settings = storage.getSettings();
  const hours = settings.fetchIntervalHours || 1;
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

function getStatus() {
  return {
    running: isRunning,
    scheduled: !!scheduledJob,
    lastFetch: storage.getLastFetch(),
  };
}

module.exports = { start, stop, fetchAll, getStatus };
