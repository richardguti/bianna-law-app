/**
 * tools/check-citations.js — verify statute citations against the bundled corpus.
 *
 * The offline agents make one promise: every citation they emit is retrieved, never invented.
 * A doctrine map that cites a section the corpus does not contain breaks that promise at the
 * data layer, where no runtime guard can catch it -- the agent would simply find nothing and
 * reflect, while the map claims coverage it does not have.
 *
 * So every section number a doctrine map names is checked here BEFORE the agent ships, and the
 * catchline is printed so the mapping can be judged, not just counted.
 *
 *   node tools/check-citations.js 768.81 767.01 95.11
 *   node tools/check-citations.js --chapter 90        # every section present in a chapter
 *   node tools/check-citations.js --title-40          # chapter inventory for a title directory
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CORPUS = path.join(__dirname, '..', 'jsons', 'references', 'florida-statutes');

function titleDirs() {
  return fs.readdirSync(CORPUS).filter((d) => fs.statSync(path.join(CORPUS, d)).isDirectory());
}

/** section -> absolute path, built once. The corpus is flat per title directory. */
let _index = null;
function index() {
  if (_index) return _index;
  _index = new Map();
  for (const d of titleDirs()) {
    for (const f of fs.readdirSync(path.join(CORPUS, d))) {
      if (!f.endsWith('.md')) continue;
      _index.set(f.slice(0, -3), path.join(CORPUS, d, f));
    }
  }
  return _index;
}

function catchlineOf(p) {
  try {
    const first = fs.readFileSync(p, 'utf8').split('\n')[0];
    return (first.split('\u2014').slice(1).join('\u2014') || '').trim();
  } catch { return ''; }
}

const argv = process.argv.slice(2);

if (argv[0] === '--chapter') {
  const ch = argv[1] + '.';
  const found = [...index().entries()].filter(([s]) => s.startsWith(ch))
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  console.log('chapter ' + argv[1] + ': ' + found.length + ' sections present');
  for (const [s, p] of found) console.log('  ' + s.padEnd(12) + catchlineOf(p).slice(0, 70));
} else if (argv[0] && argv[0].startsWith('--title-')) {
  const key = argv[0].replace('--title-', '').replace(/[^0-9]/g, '');
  const chapters = new Set();
  for (const [s] of index()) if (s.startsWith(key + '.') || /^\d+$/.test(s)) chapters.add(s.split('.')[0]);
  // list the title directory's own chapters
  const d = titleDirs().find((x) => x.startsWith('title-' + key + '-'));
  if (!d) { console.log('no title directory for ' + key + '; directories are:'); for (const x of titleDirs()) console.log('  ' + x); process.exit(0); }
  const chs = new Set();
  for (const f of fs.readdirSync(path.join(CORPUS, d))) chs.add(f.split('.')[0]);
  console.log(d + ' -> ' + chs.size + ' chapters: ' + [...chs].sort((a, b) => a - b).join(', '));
} else if (argv[0] === '--agents') {
  // Gate: every statute cited by every agent's doctrine maps must exist in the bundle.
  // This is the check that keeps the data layer honest. A doctrine map naming a section the
  // corpus does not contain breaks the retrieval promise where no runtime guard can catch it:
  // the agent simply finds nothing and reflects, while the map claims coverage it does not have.
  const dataRoot = path.join(__dirname, '..', 'jsons', 'data', 'offline');
  const rt = JSON.parse(fs.readFileSync(path.join(dataRoot, 'router.json'), 'utf8'));
  let totalMissing = 0;
  for (const id of rt.active || []) {
    const dir = path.join(dataRoot, rt.agents[id].path);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^doctrine-map.*\.json$/.test(f)) : [];
    const cited = new Set();
    let doctrines = 0;
    for (const f of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const [key, d] of Object.entries(parsed.doctrines || {})) {
        doctrines++;
        for (const s of d.statutes || []) cited.add(s);
      }
    }
    const missing = [...cited].filter((s) => !index().has(s));
    totalMissing += missing.length;
    console.log(id.padEnd(14) + ' doctrines=' + String(doctrines).padStart(3)
      + '  statutes=' + String(cited.size).padStart(3)
      + '  missing=' + missing.length + (missing.length ? '  -> ' + missing.join(', ') : ''));
  }
  console.log('\n' + (totalMissing ? totalMissing + ' MISSING CITATION(S)' : 'all citations grounded in the bundle'));
  process.exit(totalMissing ? 1 : 0);
} else {
  if (!argv.length) { console.log('usage: node tools/check-citations.js <section...> | --chapter N | --title-N'); process.exit(0); }
  let present = 0, absent = 0;
  for (const s of argv) {
    const p = index().get(s);
    if (p) { present++; console.log('  PRESENT  ' + s.padEnd(12) + catchlineOf(p).slice(0, 72)); }
    else { absent++; console.log('  ABSENT   ' + s); }
  }
  console.log('\n' + present + ' present, ' + absent + ' absent');
  process.exit(absent ? 1 : 0);
}
