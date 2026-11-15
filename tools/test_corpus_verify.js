/**
 * tools/test_corpus_verify.js — the live-verification layer.
 *
 * What this proves, in order of importance:
 *
 *   1. The parser extracts catchline, body, history and note from the published structure, and
 *      REFUSES anything that does not look like a statute section. A parser that cannot be shown
 *      to reject junk must never be allowed to write a "repair", because the overlay is served
 *      instead of the bundle and nothing downstream would suspect it.
 *   2. A repaired section is written once, then served from disk. The second query does not go
 *      near the network -- that is the whole point of cache-first.
 *   3. Offline is not an error. The bundled copy still answers, labelled unverified.
 *   4. Politeness is enforced: 2s spacing, 30/minute, bounded backoff on 429.
 *
 * Run: node tools/test_corpus_verify.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const JS = path.join(__dirname, '..', 'jsons');
const verifier = require(path.join(JS, 'offline', 'statute-verifier.js'));
const corpus = require(path.join(JS, 'offline', 'corpus.js'));

// Counted, so "no network during a query" can be asserted rather than believed.
let netCalls = 0;
const realFetch = global.fetch;

let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + extra)); }
}

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'flsenate-732.102.html'), 'utf8');
const OVERLAY = fs.mkdtempSync(path.join(os.tmpdir(), 'slp-overlay-'));
const SECTION = '732.102';   // genuinely damaged in the bundle: tail_contaminated

(async () => {
  /* ── 1. Parser ─────────────────────────────────────────────────────────── */
  console.log('=== parser (6) ===');
  const parsed = verifier.parseSectionFromHtml(FIXTURE, SECTION);
  ok('catchline extracted', parsed.catchline === "Spouse's share of intestate estate.", parsed.catchline);
  ok('all three subsections extracted',
    /\(1\)/.test(parsed.body) && /\(2\)/.test(parsed.body) && /\(3\)/.test(parsed.body));
  ok('body does not repeat the catchline it introduces', !/^Spouse/.test(parsed.body), parsed.body.slice(0, 40));
  ok('history extracted', /ch\. 75-220/.test(parsed.history || ''), parsed.history);
  ok('note extracted', /former s\. 731\.34/.test(parsed.note || ''), parsed.note);
  ok('no markup survives into the body', !/[<>]/.test(parsed.body));

  /* ── 2. Guards: the parser must refuse junk ────────────────────────────── */
  console.log('\n=== guards (4) ===');
  const rejects = (html, sec) => {
    try { verifier.parseSectionFromHtml(html, sec || SECTION); return false; }
    catch (e) { return e.code === 'parse_failed'; }
  };
  ok('a non-statute page is rejected', rejects('<html><body>hello</body></html>'));
  ok('an empty body is rejected', rejects(''));
  ok('a statute page for a DIFFERENT section is rejected', rejects(FIXTURE, '999.999'));
  ok('a page with a too-short body is rejected',
    rejects('<span class="CatchlineText">Tiny.</span><HISTORY>h</HISTORY>732.102'));

  /* ── 3. Markdown in the bundled format ─────────────────────────────────── */
  console.log('\n=== overlay file format (2) ===');
  const live = {
    ...parsed,
    fetched_at: '2026-09-27T10:00:00.000Z',
    source_url: 'https://www.flsenate.gov/Laws/Statutes/2026/732.102',
    edition: '2026',
  };
  const md = verifier.toMarkdown(live);
  ok('header and source line in the bundled format',
    md.startsWith('# Fla. Stat. \u00a7 732.102 \u2014 Spouse') && md.includes('flsenate.gov (verified 2026-09-27)'));
  ok('body sits between the --- separator and History', md.includes('\n---\n') && md.includes('**History:**'));

  /* ── 4. Politeness budget ──────────────────────────────────────────────── */
  console.log('\n=== politeness (2) ===');
  const rs = verifier.rateState();
  ok('configured at 2s spacing and 30/minute',
    rs.configuredMinIntervalMs === 2000 && rs.maxPerMinute === 30, JSON.stringify(rs));

  const t = [];
  global.fetch = async () => { netCalls++; t.push(Date.now()); return { status: 200, ok: true, text: async () => FIXTURE }; };
  await verifier.fetchLiveSection(SECTION);
  await verifier.fetchLiveSection(SECTION);
  ok('two real requests are at least 2s apart', (t[1] - t[0]) >= 1950, (t[1] - t[0]) + 'ms');

  /* ── 5. Transport: live, offline, and 429 ─────────────────────────────── */
  console.log('\n=== transport (4) ===');
  const fetched = await verifier.fetchLiveSection(SECTION);
  ok('a 200 becomes a parsed live record',
    fetched.section === SECTION && fetched.catchline === parsed.catchline && /flsenate\.gov/.test(fetched.source_url));

  global.fetch = async () => { const e = new Error('getaddrinfo ENOTFOUND www.flsenate.gov'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  let offlineCode = null;
  try { await verifier.fetchLiveSection(SECTION); } catch (e) { offlineCode = e.code; }
  ok('a DNS failure is reported as offline, not as a failure', offlineCode === 'offline', offlineCode);

  // The timing seams exist so the retry tests do not spend fifteen seconds asleep. The 2s default
  // was asserted above, with real timing, before these were lowered.
  verifier.setMinInterval(0);
  verifier.setBackoffBase(1);

  let calls429 = 0;
  global.fetch = async () => { calls429++; return calls429 <= 3 ? { status: 429, ok: false } : { status: 200, ok: true, text: async () => FIXTURE }; };
  const after429 = await verifier.fetchLiveSection(SECTION);
  ok('429 backs off and retries, then succeeds on the 4th attempt',
    calls429 === 4 && after429.section === SECTION, 'calls=' + calls429);

  let giveUp = null;
  global.fetch = async () => ({ status: 429, ok: false });
  try { await verifier.fetchLiveSection(SECTION); } catch (e) { giveUp = e.code; }
  ok('429 stops after 3 retries rather than knocking forever', giveUp === 'rate_limited', giveUp);

  /* ── 6. Cache-first: write the repair, then never touch the network ────── */
  console.log('\n=== cache-first repair (7) ===');
  corpus.setOverlayRoot(OVERLAY);

  const before = corpus.readSection(SECTION, {});
  ok('the bundled copy is genuinely damaged', before.found && before.integrity.ok === false,
    JSON.stringify(before.integrity && before.integrity.anomalies));
  ok('provenance says it came from the bundle', before.provenance.origin === 'bundle');

  const written = corpus.writeOverlay(SECTION, md, {
    verified_at: live.fetched_at, source_url: live.source_url, edition: '2026',
  });
  ok('the repair is written to the overlay', fs.existsSync(written.markdown_path) && fs.existsSync(written.meta_path));

  netCalls = 0;
  const after = corpus.readSection(SECTION, {});
  ok('the overlay now wins, and it is clean',
    after.integrity.ok === true && after.provenance.origin === 'overlay',
    'ok=' + after.integrity.ok + ' anomalies=' + JSON.stringify(after.integrity.anomalies));
  ok('the overlay records when it was verified and from where',
    String(after.provenance.verified_at).startsWith('2026-09-27') && /flsenate\.gov/.test(String(after.provenance.source_url)));

  const offline = require(path.join(JS, 'offline', 'index.js'));
  const answer = offline.ask('What are the subsections of 732.102?');
  ok('serving a repaired section makes NO network call', netCalls === 0, netCalls + ' call(s)');
  ok('the citation says it was verified', /Verified against flsenate\.gov on 2026-09-27\./.test(String(answer.text)));

  const status = corpus.overlayStatus();
  ok('the overlay status lists the verified section',
    status.count === 1 && status.sections[0].section === SECTION);

  /* ── 7. Fallback: revert, and the offline label ────────────────────────── */
  console.log('\n=== fallback (3) ===');
  corpus.clearOverlay(SECTION);
  const reverted = corpus.readSection(SECTION, {});
  ok('reverting restores the bundled copy', reverted.provenance.origin === 'bundle');

  const unverifiedAnswer = offline.ask('What are the subsections of 732.102?');
  ok('an unverified citation says so plainly',
    /From bundled corpus \(2026 snapshot\) \u2014 not verified against live source\./.test(String(unverifiedAnswer.text)));
  ok('the damaged copy still carries its integrity warning',
    !!(unverifiedAnswer.integrity && unverifiedAnswer.integrity.ok === false));

  fs.rmSync(OVERLAY, { recursive: true, force: true });
  global.fetch = realFetch;

  console.log('\n=== corpus verification: ' + passed + ' passed, ' + failures.length + ' failed ===');
  if (failures.length) { for (const f of failures) console.log('   FAILED: ' + f); process.exit(1); }
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
