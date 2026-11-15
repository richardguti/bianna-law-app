/**
 * Scope-refusal contract test — the executable form of a rule that, for one cycle,
 * existed only as a comment in icm.js.
 *
 * The rule:
 *   A federal-constitutional doctrine query MAY be answered from the student's own
 *   materials, and NEVER from the codified Florida Statutes.
 *
 * Why it needs a test: the first version of this fix refused on scope BEFORE running
 * retrieval, which would have suppressed her own Con Law outline for "minimum
 * contacts" — a source she genuinely owns and that genuinely answers the question.
 * The near-miss was caught by reading the existing test corpus, not by any assertion.
 * These three cases are what turn it into a rule.
 *
 * Each case runs in its own child process: icm.js resolves INDEX_PATH at module load,
 * so isolated corpora need isolated processes.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELF = __filename;

const OUTLINE = `PERSONAL JURISDICTION. International Shoe requires minimum contacts
with the forum State such that maintenance of the suit does not offend traditional
notions of fair play and substantial justice.`;

// Deliberately mimics the real trap: a Florida statute whose *body and catchline*
// contain the query's words ("contact", "minimum") while addressing something else
// entirely (juvenile procedure). This is what § 39.0139 did to the real index.
const STATUTE = `# Fla. Stat. § 39.0139 — Contact with a child; juvenile procedure.

**Chapter:** 39 — PROCEEDINGS RELATING TO CHILDREN
**Section:** 39.0139
**Source:** bundled offline corpus

---

The department shall supervise contact between the child and the parent, and shall
set minimum standards for such contact in the case plan.
`;

function build(caseName, root) {
  const corpus = path.join(root, 'corpus');
  fs.mkdirSync(corpus, { recursive: true });
  if (caseName === 'outline' || caseName === 'both') {
    fs.mkdirSync(path.join(corpus, 'Con Law'), { recursive: true });
    fs.writeFileSync(path.join(corpus, 'Con Law', 'Master Outline.md'), OUTLINE, 'utf8');
  }
  if (caseName === 'statutes' || caseName === 'both') {
    fs.mkdirSync(path.join(corpus, 'florida-statutes', 'title-5'), { recursive: true });
    fs.writeFileSync(path.join(corpus, 'florida-statutes', 'title-5', '39.0139.md'), STATUTE, 'utf8');
  }
  return corpus;
}

async function runCase(index, corpus) {
  process.env.ICM_INDEX_PATH = index;
  const icm = require(path.join(__dirname, '..', 'jsons', 'icm.js'));
  await icm.sync(corpus);
  const r = icm.retrieve('minimum contacts', 3);
  console.log('RESULT ' + JSON.stringify({
    matched: r.matched,
    scope: r.scope,
    disciplines: r.hits.map((h) => h.discipline),
    count: r.hits.length,
  }));
}

function child(caseName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-' + caseName + '-'));
  const index = path.join(root, 'icm-index.json');
  const corpus = build(caseName, root);
  const r = spawnSync(process.execPath, [SELF, '--run', caseName, index, corpus], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { ICM_INDEX_PATH: index }),
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = out.split('\n').filter((l) => l.trim().startsWith('RESULT ')).pop();
  if (!line) return { error: 'no RESULT line; child said: ' + out.trim().slice(-300) };
  return JSON.parse(line.slice('RESULT '.length));
}

if (process.argv[2] === '--run') {
  // argv is [node, script, '--run', caseName, indexPath, corpusPath] — the index is
  // argv[4], NOT argv[3]. An earlier version read argv[3] (the case name) as the index
  // and argv[4] as the corpus, so sync() scanned a JSON file path and indexed nothing —
  // the test then reported a product failure for what was an argument-indexing bug.
  runCase(process.argv[4], process.argv[5])
    .catch((e) => { console.error(e && e.stack || e); process.exit(1); });
} else {
  let pass = 0, fail = 0;
  const check = (ok, msg) => { console.log((ok ? '  [PASS] ' : '  [FAIL] ') + msg); if (ok) pass++; else fail++; };
  const NON_STATUTE = (d) => d !== 'florida_statutes';

  console.log('--- case A: her own Con Law outline ONLY ---');
  let a = child('outline');
  if (a.error) { console.log('  [FAIL] ' + a.error); fail++; }
  else {
    check(a.matched === true, 'MATCHES from her own outline (a source she owns)');
    check(a.disciplines.length > 0 && a.disciplines.every(NON_STATUTE), 'and the source is not the codified statutes');
  }

  console.log('--- case B: bundled Florida Statutes ONLY ---');
  let b = child('statutes');
  if (b.error) { console.log('  [FAIL] ' + b.error); fail++; }
  else {
    check(b.matched === false, 'REFUSES "minimum contacts" against statutes alone');
    check(b.scope === 'federal-constitutional', 'and names the scope as federal-constitutional');
    check(b.count === 0, 'and returns zero hits (not the statute whose text contains the words)');
  }

  console.log('--- case C: BOTH present ---');
  let c = child('both');
  if (c.error) { console.log('  [FAIL] ' + c.error); fail++; }
  else {
    check(c.matched === true, 'MATCHES (her outline is present)');
    check(c.disciplines.every(NON_STATUTE), 'and NEVER returns the Florida statute');
  }

  console.log('\n=== SCOPE REFUSAL: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
}
