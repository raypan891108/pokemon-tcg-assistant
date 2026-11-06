const axios = require('axios');

// GET for the scrapers that recognises a site's bot-protection page. Those pages come back
// as a 403 or, worse, as a 200 with no content, which would look like an empty list.
// The error says which protection blocked us; it isn't something to retry around.

function blockedBy(res) {
  const body = typeof res?.data === 'string' ? res.data : '';
  if (/Attention Required! \| Cloudflare|Just a moment\.\.\.|cf-chl-/.test(body)) return 'Cloudflare';
  if (/Pardon Our Interruption|_Incapsula_Resource/.test(body) || res?.headers?.['x-iinfo']) return 'Imperva';
  return null;
}

function blockedError(by) {
  const error = new Error(`官網擋掉了自動抓取（${by} 機器人防護）`);
  error.blocked = by;
  return error;
}

async function get(url, options) {
  let res;
  try {
    res = await axios.get(url, options);
  } catch (e) {
    const by = blockedBy(e.response);
    throw by ? blockedError(by) : e;
  }
  const by = blockedBy(res);
  if (by) throw blockedError(by);
  return res.data;
}

module.exports = { get };
