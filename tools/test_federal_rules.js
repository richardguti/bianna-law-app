/**
 * tools/test_federal_rules.js — the assertions that stop the next extraction regressing silently.
 *
 * Five groups, per corpus:
 *
 *   1. WELL-KNOWN RULES PRESENT   — a curated subset per rule set, so a dropped rule is caught.
 *   2. BODY PRESENT / ABSENT      — operative rules have a body; abrogated rules do not.
 *   3. NO FOREIGN TEXT            — no Florida `F.S.` splice marker, and no captured heading for a
 *                                   different rule. Rule text legitimately cross-references other
 *                                   rules ("under Rule 4"), so cross-references are NOT the test;
 *                                   a captured heading is.
 *   4. MANIFEST AGREES WITH DISK  — count and rule-number set both match.
 *   5. FRONTMATTER PARSES         — on every file, with required keys and a valid status.
 *
 * Run: node tools/test_federal_rules.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REF = path.join(__dirname, '..', 'jsons', 'references');

let passed = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  -> ' + extra)); }
}

/** A curated subset that must exist, per rule set. */
const WELL_KNOWN = {
  'federal-rules-of-evidence': ['104', '403', '404', '412', '413', '414', '415', '803', '901', '1001', '1101'],
  'federal-rules-of-civil-procedure': ['1', '4', '8', '11', '12', '23', '26', '32', '56', '74', '84'],
  'federal-rules-of-criminal-procedure': ['1', '11', '12', '32', '41', '58', '61'],
  'federal-rules-of-appellate-procedure': ['1', '4', '8', '32'],
  'federal-rules-of-bankruptcy-procedure': ['1001', '1007', '2002', '3015', '7001', '8001', '9006'],
};

const REQUIRED_KEYS = ['rule_number', 'title', 'status', 'cite', 'edition', 'source', 'authority'];

function parseFrontmatter(text) {
  const lines = String(text).split('\n');
  if (lines[0].trim() !== '---') return null;
  const fm = {};
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }
  let j = i + 1;
  for (; j < lines.length && lines[j].trim() !== '---'; j++) { /* skip the human-readable header */ }
  return {
    fm,
    body: lines.slice(j + 1).join('\n').trim(),
    closed: i < lines.length && j < lines.length,
  };
}

// Every edition-suffixed rules corpus, so a new edition is picked up automatically.
const corpora = fs.readdirSync(REF).filter((d) => /^federal-rules-.*-\d{4}-\d{2}-\d{2}$/.test(d));
if (!corpora.length) { console.log('  FAIL no federal-rules corpora found under jsons/references'); process.exit(1); }

for (const dir of corpora) {
  const base = dir.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  const full = path.join(REF, dir);
  const mdFiles = fs.readdirSync(full).filter((f) => f.endsWith('.md'));
  console.log('\n=== ' + dir + ' ===');

  /* 1. Well-known rules present */
  const nums = new Set(mdFiles.map((f) => f.slice(0, -3)));
  const want = WELL_KNOWN[base] || [];
  const missing = want.filter((n) => !nums.has(n));
  ok('well-known rules present (' + want.length + ' checked)', missing.length === 0, 'missing: ' + missing.join(', '));

  /* 5. Frontmatter parses everywhere, checked before 2 and 3 so those can trust it */
  const parsed = new Map();
  const badFm = [];
  for (const f of mdFiles) {
    const p = parseFrontmatter(fs.readFileSync(path.join(full, f), 'utf8'));
    if (!p || !p.closed) { badFm.push(f + ': delimiters'); continue; }
    const absent = REQUIRED_KEYS.filter((k) => !p.fm[k]);
    if (absent.length) { badFm.push(f + ': missing ' + absent.join('/')); continue; }
    if (!['operative', 'abrogated'].includes(p.fm.status)) { badFm.push(f + ': bad status'); continue; }
    if ((p.fm.status === 'abrogated') !== !!p.fm.editorial_note) { badFm.push(f + ': editorial_note/status mismatch'); continue; }
    if (p.fm.rule_number !== f.slice(0, -3)) { badFm.push(f + ': rule_number mismatch'); continue; }
    parsed.set(f.slice(0, -3), p);
  }
  ok('frontmatter parses on all ' + mdFiles.length + ' files', badFm.length === 0, badFm.slice(0, 5).join(' | '));

  /* 2. Body present iff operative */
  const bodyProblems = [];
  for (const [num, p] of parsed) {
    const hasBody = p.body.length > 0;
    if (p.fm.status === 'operative' && !hasBody) bodyProblems.push(num + ': operative but empty');
    if (p.fm.status === 'abrogated' && hasBody) bodyProblems.push(num + ': abrogated but has text');
  }
  ok('body present iff operative', bodyProblems.length === 0, bodyProblems.slice(0, 5).join(' | '));

  /* 3. No foreign text */
  const foreign = [];
  const leaky = [];
  for (const [num, p] of parsed) {
    if (/\bF\.S\.\s*\d/.test(p.body)) foreign.push(num + ': F.S. marker');
    if (/\.{4,}/.test(p.body)) leaky.push(num + ': dot-leader contents line in body');
    for (const line of p.body.split('\n')) {
      const m = /^\**\s*Rule\s+(\d{1,4}[A-Za-z]?)\s*\./.exec(line.trim());
      if (m && m[1] !== num) foreign.push(num + ': captured heading for Rule ' + m[1]);
    }
  }
  ok('no foreign or spliced text in any body', foreign.length === 0, foreign.slice(0, 5).join(' | '));
  ok('no contents-list lines leaked into any body', leaky.length === 0, leaky.slice(0, 5).join(' | '));

  /* 4. Manifest agrees with disk */
  const mfPath = path.join(full, '_manifest.json');
  if (!fs.existsSync(mfPath)) { ok('manifest agrees with disk', false, '_manifest.json absent'); continue; }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const mfSet = new Set(mf.rules || []);
  const setDiff = [...nums].filter((n) => !mfSet.has(n)).concat([...mfSet].filter((n) => !nums.has(n)));
  ok('manifest count and rule set match disk',
    mf.count === mdFiles.length && setDiff.length === 0 && !!mf.edition && !!mf.cite,
    'count=' + mf.count + '/' + mdFiles.length + ' edition=' + mf.edition + ' diff=' + setDiff.slice(0, 5).join(','));
}

/* ── Positive controls ──────────────────────────────────────────────────────
   Every verifier must demonstrate that it FAILS on known-bad input before its pass output is
   trusted. Five separate verifier bugs in this cycle -- the last of which deleted real content
   from the source -- is the evidence that a pass rate means nothing until the instrument has been
   shown to fail.

   These controls run the REAL verifier CLI against a one-file corpus, so they exercise the shipped
   instrument rather than a re-implementation of it. */
console.log('\n=== verifier positive controls ===');

const os = require('os');
const cp = require('child_process');

const FRCP_PDF = path.join(__dirname, 'sources', 'federal-rules', 'federal-rules-of-civil-procedure-dec-1-2024_0.pdf');
const FRCP_DIR = path.join(REF, 'federal-rules-of-civil-procedure-2024-12-01');
const VERIFIER = path.join(__dirname, 'verify-federal-rules.js');

function bodyOf(ruleFile) {
  return fs.readFileSync(path.join(FRCP_DIR, ruleFile), 'utf8').split(/\n---\n/)[2].trim();
}

/** Run the verifier on a one-file corpus built from the real frontmatter plus a supplied body. */
function runVerifier(ruleFile, body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slp-ctrl-'));
  try {
    const src = fs.readFileSync(path.join(FRCP_DIR, ruleFile), 'utf8');
    const head = src.slice(0, src.indexOf('\n---\n', 4) + 5);   // through the frontmatter close
    fs.writeFileSync(path.join(tmp, ruleFile),
      head + '\n# control\n\n**Rule:** control \u00b7 **Status:** operative\n\n---\n\n' + body + '\n', 'utf8');
    const out = cp.execFileSync(process.execPath, [VERIFIER, tmp, FRCP_PDF], { encoding: 'utf8' });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Control 0 first: the control must be capable of PASSING, or it proves nothing.
{
  const body = bodyOf('12.md');
  ok('control 0: an intact real body PASSES (control is not always-failing)',
    runVerifier('12.md', body).status === 0);
}

/* Control 1 — containment must fail when text is deleted. Guards against the case-sensitivity fix
   over-correcting into a verifier that matches too little. */
{
  const body = bodyOf('12.md');
  const mutated = body.replace('TIME TO SERVE', '');
  ok('control 1: containment FAILS when a distinctive phrase is deleted',
    mutated !== body && runVerifier('12.md', mutated).status === 1);
}

/* Control 2 — the small-caps detector must report an injected split. Without this, "0 REAL
   defects" across four corpora is indistinguishable from a detector tuned below usefulness. */
{
  const body = bodyOf('60.md');
  const mutated = body.replace('PROCEEDING', 'P ROCEEDING');
  const ran = runVerifier('60.md', mutated);
  ok('control 2: small-caps detector REPORTS an injected "P ROCEEDING"',
    mutated !== body && /1 REAL defect/.test(ran.out), ran.out.match(/small-caps[^\n]*/)?.[0]);
}

/* Control 3 — a contents line appended to a body must break containment. This is the direct test
   of the dot-leader rule that fixed FRBP 7052. */
{
  const body = bodyOf('12.md');
  ok('control 3: containment FAILS when a contents line is appended',
    runVerifier('12.md', body + '\nRule 9999. Test ........................ 42').status === 1);
}

console.log('\n=== federal rules: ' + passed + ' passed, ' + failures.length + ' failed ===');
if (failures.length) { for (const f of failures) console.log('   FAILED: ' + f); process.exit(1); }
