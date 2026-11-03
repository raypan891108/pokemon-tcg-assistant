const cron = require('node-cron');
const storage = require('./storage');
const notifier = require('./notifier');
const market = require('./market');
const backup = require('./backup');
const twScraper = require('../scrapers/tw-scraper');
const jpScraper = require('../scrapers/jp-scraper');
const usScraper = require('../scrapers/us-scraper');

const SCRAPERS = { tw: twScraper, jp: jpScraper, us: usScraper };
// Each scraper's function per kind of data
const SCRAPE_METHODS = { products: 'scrapeProducts', events: 'scrapeEvents', tournaments: 'scrapeTournaments' };

let isRunning = false;
let scheduledJob = null;
let intervalHours = null;
// Result of the most recent fetch, shown in the sidebar
let lastRun = null;

async function fetchAll() {
  if (isRunning) {
    console.log('[Scheduler] Fetch already in progress, skipping...');
    return { success: false, reason: 'already_running' };
  }
  isRunning = true;
  try {
    const result = await runFetch();
    lastRun = { at: new Date().toISOString(), ...result };
    return result;
  } finally {
    isRunning = false;
  }
}

// Matches the cron expression `0 */h * * *`: the next top of an hour divisible by h
function nextRunAt(hours, now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  do {
    next.setHours(next.getHours() + 1);
  } while (next.getHours() % hours !== 0);
  return next.toISOString();
}

// A run that errors or finds nothing counts as failed: a scraper whose page layout changed
// usually returns an empty list rather than an error. Regions no longer fetched are dropped.
async function updateSources(sourceResults) {
  const prev = await storage.getSources();
  const now = new Date().toISOString();
  const next = {};
  for (const [key, { count, error }] of Object.entries(sourceResults)) {
    const ok = !error && count > 0;
    next[key] = {
      count,
      error,
      lastRunAt: now,
      lastSuccessAt: ok ? now : prev[key]?.lastSuccessAt || null,
      failStreak: ok ? 0 : (prev[key]?.failStreak || 0) + 1,
    };
  }
  await storage.saveSources(next);
}

async function runFetch() {
  const results = { products: [], events: [], tournaments: [], errors: [] };
  const fetched = [];

  console.log('[Scheduler] Starting data fetch...');
  const startTime = Date.now();

  const settings = await storage.getSettings();
  const regions = (settings.regions || ['tw', 'jp', 'us']).filter(r => SCRAPERS[r]);

  // Fetch from all regions in parallel, noting how each source did
  const sourceResults = {};
  const tasks = regions.flatMap(region => {
    const scraper = SCRAPERS[region];
    const label = region.toUpperCase();
    return Object.entries(SCRAPE_METHODS).map(([kind, method]) => {
      return scraper[method]().then(items => {
        results[kind].push(...items);
        if (kind === 'products') fetched.push(`${region}-products`);
        sourceResults[`${region}-${kind}`] = { count: items.length, error: null };
      }, e => {
        results.errors.push(`${label} ${kind}: ${e.message}`);
        sourceResults[`${region}-${kind}`] = { count: 0, error: e.message };
      });
    });
  });

  await Promise.allSettled(tasks);
  await updateSources(sourceResults);

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

  // Daily copy of your own records (inventory, watchlist, settings)
  try {
    await backup.backupIfDue();
  } catch (e) {
    results.errors.push(`Backup: ${e.message}`);
  }

  // Send Discord notifications for new items
  await notifier.notifyNewProducts(newProducts);
  await notifier.notifyNewEvents(newEvents);
  await notifier.notifyNewTournaments(newTournaments);
  await notifier.notifyDeadlineReminders();
  await notifier.notifyReleaseReminders();

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
  intervalHours = hours;
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
  const lastFetch = await storage.getLastFetch();
  // Before the first fetch of this run, fall back to the newest saved timestamp
  const lastSaved = Object.values(lastFetch).sort().pop() || null;
  return {
    running: isRunning,
    scheduled: !!scheduledJob,
    intervalHours,
    lastRunAt: lastRun?.at || lastSaved,
    nextRunAt: scheduledJob ? nextRunAt(intervalHours) : null,
    lastResult: lastRun && {
      newProducts: lastRun.newProducts,
      newEvents: lastRun.newEvents,
      newTournaments: lastRun.newTournaments,
      errors: lastRun.errors?.length || 0,
    },
    lastFetch,
    sources: await storage.getSources(),
  };
}

module.exports = { start, stop, fetchAll, getStatus };
