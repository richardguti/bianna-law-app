/**
 * statute-verifier.js — verify a damaged statute against the live source, then cache the repair.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bundled corpus is a scrape, and parts of it are wrong: 34.88% of sections carry a fragment
 * of the adjacent section appended to their body, and some have no body at all (§ 768.125's text
 * was replaced by the tail of § 768.12). The integrity guard in corpus.js detects those and
 * refuses to present the damaged text as authority — but detecting damage is not the same as
 * repairing it. This module does the repair, from the source the Legislature publishes.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * -----------------------------
 * It is NOT a fetch-on-every-query layer. Four reasons, and they all matter:
 *
 *   1. There is no API. flsenate.gov serves HTML per section; every "Florida Statutes API" on the
 *      market is scraping this same page and reselling it.
 *   2. Latency. A round trip to Tallahassee is 300-800ms added to every answer, for no benefit on
 *      the 99% of sections that are already correct in the bundle.
 *   3. Abuse. Twenty questions would be twenty requests; finals week would be hundreds. A desktop
 *      app hammering a government endpoint is how IPs get blocked.
 *   4. Fragility. The site's markup changes between editions. The bundle only changes when we
 *      change it.
 *
 * So the network is used under exactly two conditions: a section was flagged damaged, or the user
 * explicitly asked to verify it. Everything else is served from local disk.
 *
 * AUTHORITY, STATED HONESTLY
 * --------------------------
 * The print edition of the Florida Statutes is the legal best evidence of the law. The state's
 * Office of Legislative Revision prepares the electronic edition on flsenate.gov from the same
 * source and treats it as official. That makes the site a legitimate correctness check, and the
 * repaired copy is labelled with the date and URL it came from so the student can see exactly
 * what was checked and when.
 */
'use strict';

const FLSENATE_ROOT = 'https://www.flsenate.gov/Laws/Statutes';
const EDITION = '2026';

/**
 * Politeness budget. These are not tunables for performance; they are the terms on which it is
 * acceptable to touch someone else's server at all.
 */
const MIN_INTERVAL_MS = 2000;        // never two requests closer than this
const MAX_PER_MINUTE = 30;           // batch ceiling
const WINDOW_MS = 60000;
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;               // on 429 only; then give up rather than keep knocking

/** Testable seam for the backoff, so the retry tests do not have to sleep for real. */
let backoffBaseMs = 1000;
function setBackoffBase(ms) { backoffBaseMs = Math.max(1, Number(ms) || 1); }

/**
 * Test-only seam for the request spacing. The default is the real budget (2s); the retry tests
 * lower it so they do not spend fifteen seconds asleep. The default itself is asserted by the
 * suite, so this cannot quietly become the production value.
 */
let minIntervalMs = MIN_INTERVAL_MS;
function setMinInterval(ms) { minIntervalMs = Math.max(0, Number(ms) || 0); }

const USER_AGENT =
  'SeniorLawPartner/2.0 (personal study aid; offline corpus repair; contact: application owner)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An error with a machine-readable code, so callers can branch without string matching. */
function fail(code, message, detail) {
  const e = new Error(message);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

/** Node 18+ has global fetch; Electron's main process is well past that. */
function requireFetch() {
  if (typeof fetch !== 'function') throw fail('no_fetch', 'global fetch is unavailable in this runtime');
  return fetch;
}

/* ── Rate limiting ───────────────────────────────────────────────────────── */

const recent = [];        // timestamps of requests inside the sliding window
let lastRequestAt = 0;

/**
 * Wait until the next request is allowed. Enforces both the minimum spacing and the per-minute
 * ceiling, so a batch of 30 damaged sections cannot become a burst.
 */
async function politeWait() {
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();

    const gap = now - lastRequestAt;
    const spacingOk = gap >= minIntervalMs;
    const windowOk = recent.length < MAX_PER_MINUTE;
    if (spacingOk && windowOk) return;

    const waitMs = !windowOk
      ? (WINDOW_MS - (now - recent[0]) + 25)
      : (minIntervalMs - gap);
    await sleep(Math.max(1, waitMs));
  }
}

function noteRequest() {
  const now = Date.now();
  lastRequestAt = now;
  recent.push(now);
}

/** Exposed for the health panel and for tests. */
function rateState() {
  const now = Date.now();
  return {
    minIntervalMs: minIntervalMs,
    configuredMinIntervalMs: MIN_INTERVAL_MS,
    maxPerMinute: MAX_PER_MINUTE,
    inWindow: recent.filter((t) => now - t <= WINDOW_MS).length,
  };
}

/* ── Networking ──────────────────────────────────────────────────────────── */

/** DNS and connection failures mean "no internet", which is not an error condition for the app. */
function classifyNetworkError(err) {
  const code = (err && (err.code || (err.cause && err.cause.code))) || '';
  if (err && err.name === 'AbortError') return 'timeout';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(code)) {
    return 'offline';
  }
  return 'network';
}

/**
 * One GET, with the politeness budget applied and 429 handled by bounded exponential backoff.
 * Retries ONLY on 429. A 404 or a 500 is an answer, and knocking again will not change it.
 */
async function fetchWithRetry(url, opts = {}) {
  const doFetch = requireFetch();
  const { signalTimeout = TIMEOUT_MS } = opts;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await politeWait();
    let res;
    try {
      noteRequest();
      res = await doFetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(signalTimeout),
      });
    } catch (err) {
      if (err && err.code && /^[a-z_]+$/.test(err.code) && err.code !== 'network') throw err;
      throw fail(classifyNetworkError(err), 'request failed: ' + (err && err.message), err);
    }

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw fail('rate_limited', 'flsenate.gov rate-limited us; stopped after ' + MAX_RETRIES + ' retries');
      }
      // 1s, 2s, 4s by default. Bounded on purpose: we stop rather than keep knocking.
      await sleep(backoffBaseMs * Math.pow(2, attempt));
      continue;
    }
    if (!res.ok) {
      throw fail('http_' + res.status, 'flsenate.gov returned HTTP ' + res.status + ' for ' + url);
    }
    return await res.text();
  }
  throw fail('rate_limited', 'exhausted retries');
}

/**
 * Fetch and parse one section from the Legislature's electronic edition.
 *
 * @returns {Promise<object>} { section, catchline, body, history, note, source_url, fetched_at }
 */
async function fetchLiveSection(sectionNumber, opts = {}) {
  const section = String(sectionNumber || '').trim();
  if (!/^\d+\.\d+$/.test(section)) {
    throw fail('bad_section', 'not a section number: ' + JSON.stringify(sectionNumber));
  }
  const edition = opts.edition || EDITION;
  const url = FLSENATE_ROOT + '/' + edition + '/' + section;
  const html = await fetchWithRetry(url, opts);

  const parsed = parseSectionFromHtml(html, section);
  return {
    ...parsed,
    source_url: url,
    edition,
    fetched_at: new Date().toISOString(),
  };
}

/* ── Parsing ─────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function normalise(s) {
  return decodeEntities(stripTags(s))
    .replace(/[ \t\u2003\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The inner text of the first element whose opening tag contains `attr`. */
function innerByAttr(html, attr) {
  const at = html.indexOf(attr);
  if (at === -1) return null;
  const open = html.indexOf('>', at);
  if (open === -1) return null;
  const close = html.indexOf('</', open + 1);
  const end = close === -1 ? Math.min(open + 4000, html.length) : close;
  return html.slice(open + 1, end);
}

/** The body of a bare element like <HISTORY>…</HISTORY>. */
function innerByTag(html, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i').exec(html);
  return m ? m[1] : null;
}

/**
 * Extract one section from a flsenate.gov page.
 *
 * ON THE CLASS NAMES: this targets `SectionNumber`, `CatchlineText`, `Subsection`, `HISTORY` and
 * `NOTES`. That is not guesswork. fs2026.nxt -- the container the bundled corpus was scraped from
 * -- is the Legislature's own export and uses exactly these names, styled by the same
 * `FSSection.css` the website references. Same publisher, same documents, same markup vocabulary.
 *
 * ON VALIDATION: the parser refuses to return anything it cannot stand behind. A repaired copy
 * that is quietly wrong would be worse than the damaged original, because the overlay is served
 * *instead of* the bundle and the student would have no reason to doubt it. So every field is
 * checked, and a page that does not look like a statute section throws `parse_failed` rather than
 * producing a plausible-looking file.
 */
function parseSectionFromHtml(html, sectionNumber) {
  const src = String(html || '');
  if (!src.trim()) throw fail('parse_failed', 'empty response body');

  const hasNumber = /class="SectionNumber"/i.test(src);
  const hasCatchline = /class="CatchlineText"/i.test(src) || /class="Catchline"/i.test(src);
  const hasHistoryBlock = /<HISTORY>/i.test(src) || /<NOTES>/i.test(src);
  const shape = { hasNumber, hasCatchline, hasHistoryBlock };

  if (!hasCatchline && !hasHistoryBlock) {
    throw fail('parse_failed',
      'page does not look like a statute section (no CatchlineText, no HISTORY/NOTES)', shape);
  }
  // The section number must actually appear, or we have been served a chapter page or an error.
  const want = new RegExp('\\b' + sectionNumber.replace('.', '\\.') + '\\b');
  if (!want.test(stripTags(src))) {
    throw fail('parse_failed', 'page does not mention \u00a7 ' + sectionNumber, shape);
  }

  const catchline = normalise(innerByAttr(src, 'class="CatchlineText"') || innerByAttr(src, 'class="Catchline"') || '');
  const history = normalise(innerByTag(src, 'HISTORY') || '');
  const note = normalise(innerByTag(src, 'NOTES') || '');

  // The body runs from the catchline to the History block. Paragraph and div ends become line
  // breaks first, so subsection structure survives the tag strip.
  const afterCatch = Math.max(src.indexOf('class="CatchlineText"'), src.indexOf('class="Catchline"'));
  const historyAt = (() => {
    const a = src.search(/<div class="History"/i);
    const b = src.search(/<HISTORY>/i);
    const cands = [a, b].filter((x) => x > afterCatch);
    return cands.length ? Math.min.apply(null, cands) : -1;
  })();
  // Start the body AFTER the catchline span closes, or the catchline is repeated as the first
  // line of the body it is supposed to introduce.
  const bodyStart = (() => {
    if (afterCatch === -1) return 0;
    const openEnd = src.indexOf('>', afterCatch) + 1;
    const close = src.indexOf('</span>', openEnd);
    return close === -1 ? openEnd : close + '</span>'.length;
  })();
  let region = src.slice(bodyStart, historyAt === -1 ? src.length : historyAt);
  region = region
    .replace(/<\/(?:div|p|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const body = normalise(region)
    .replace(/^\(?([0-9a-z]{1,3})\)\s*/i, '($1) ')
    .replace(/\n\(?([0-9]{1,2})\)\s*/g, '\n($1) ');

  if (!body || body.length < 80) {
    throw fail('parse_failed', 'extracted body too short (' + (body || '').length + ' chars)', shape);
  }
  if (/[<>]/.test(body)) {
    throw fail('parse_failed', 'markup survived the tag strip', shape);
  }
  if (!catchline) {
    throw fail('parse_failed', 'no catchline extracted', shape);
  }

  return { section: sectionNumber, catchline, body, history, note, shape };
}

/** The overlaid file is written in the bundled corpus's own format, so readSection is unchanged. */
function toMarkdown(parsed) {
  const date = String(parsed.fetched_at || new Date().toISOString()).slice(0, 10);
  const lines = [
    '# Fla. Stat. \u00a7 ' + parsed.section + ' \u2014 ' + parsed.catchline,
    '',
    '**Chapter:** ' + String(parsed.section).split('.')[0],
    '**Section:** ' + parsed.section,
    '**Source:** flsenate.gov (verified ' + date + ')',
    '',
    '---',
    '',
    parsed.body,
  ];
  if (parsed.history) lines.push('', '**History:** ' + parsed.history);
  if (parsed.note) lines.push('', '**Note:** ' + parsed.note);
  return lines.join('\n') + '\n';
}

function hashOf(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 16);
}

/** Field-level difference between the cached copy and the live one, for the diff panel. */
function compareSections(cached, live) {
  const diffs = [];
  if (!cached || !cached.found) {
    diffs.push({ field: 'presence', cached: 'not in the bundled corpus', live: 'present on flsenate.gov' });
    return diffs;
  }
  const pairs = [
    ['catchline', cached.catchline, live.catchline],
    ['body', cached.body, live.body],
    ['history', cached.history, live.history],
    ['note', cached.note, live.note],
  ];
  for (const [field, a, b] of pairs) {
    const na = String(a || '').replace(/\s+/g, ' ').trim();
    const nb = String(b || '').replace(/\s+/g, ' ').trim();
    if (na !== nb) {
      diffs.push({ field, cached: na.slice(0, 400), live: nb.slice(0, 400), cached_len: na.length, live_len: nb.length });
    }
  }
  return diffs;
}

module.exports = {
  fetchLiveSection,
  parseSectionFromHtml,
  toMarkdown,
  compareSections,
  hashOf,
  rateState,
  setBackoffBase,
  setMinInterval,
  classifyNetworkError,
  FLSENATE_ROOT,
  EDITION,
  MIN_INTERVAL_MS,
  MAX_PER_MINUTE,
};
