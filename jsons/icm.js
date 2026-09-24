/**
 * icm.js — Indexed Content Mirror for the student's own law materials.
 *
 * Purpose (ICM = the user's own corpus, indexed and mirrored):
 *   1. MIRROR   — walk a user-chosen root (default ~/Documents/Bianna_Law) plus the
 *                 app's own working directory, keeping an on-disk mirror in sync.
 *   2. LABEL    — parse course/discipline/document-type/topic out of file names and
 *                 paths (e.g. "Con Law - Marbury brief.pdf" → constitutional/law/…).
 *   3. SORT     — report which tab/folder each file belongs to so the UI can file it.
 *   4. RETRIEVE — expose getIcmContext(query, k) so the AI reasons over the STUDENT'S
 *                 OWN materials before the generic corpus (internal RAG).
 *
 * Fully offline: index is a JSON file, scoring is keyword overlap (same strategy as
 * rag.js), so there are no native binaries or network calls.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const APP_DIR       = path.join(os.homedir(), 'Documents', 'Bianna_Law');
// Overridable so tests (and a future portable-mode install) can redirect the index
// without touching the user's real corpus.
const INDEX_PATH    = process.env.ICM_INDEX_PATH
  ? path.resolve(process.env.ICM_INDEX_PATH)
  : path.join(APP_DIR, 'icm-index.json');
const MAX_CHARS     = 20000;   // per-file text stored for retrieval
const MAX_FILE_MB   = 12;

/* ── Labels ─────────────────────────────────────────────────────────────────── */

const DISCIPLINES = {
  contracts:      ['contract', 'contracts', 'k', 'ucc', 'offer', 'consideration'],
  torts:          ['tort', 'torts', 'negligence', 'battery', 'assault'],
  civ_pro:        ['civ pro', 'civil procedure', 'civpro', 'frcp', 'jurisdiction', 'erie'],
  constitutional: ['con law', 'conlaw', 'constitutional', 'constitution', '1st amendment', 'commerce clause'],
  property:       ['property', 'prop', 'estate', 'future interest', 'landlord', 'easement'],
  criminal:       ['criminal', 'crim', 'criminal law'],
  evidence:       ['evidence', 'federal rules of evidence', 'fre', 'hearsay'],
  corporations:   ['corporations', 'corp', 'business associations', 'agency'],
  legal_writing:  ['legal writing', 'lrw', 'memo', 'brief', 'cited', 'citation'],
  florida_statutes: ['florida-statutes', 'fla-stat', 'fla. stat', 'florida statute'],
  other:          [],
};

const DOC_TYPES = {
  statute:     ['florida-statutes', 'fla-stat'],
  outline:     ['outline', 'skeleton', 'attack', 'master'],
  case_brief:  ['brief', 'casebrief', 'case brief', 'holding'],
  notes:       ['notes', 'note', 'class notes', 'lecture'],
  syllabus:    ['syllabus', 'schedule', 'class schedule'],
  exam:        ['exam', 'midterm', 'final', 'mock', 'practice', 'hypo'],
  checklist:   ['checklist', 'check list', 'audit'],
  supplement:  ['supplement', 'e&e', 'examples', 'hornbook', 'glannon', 'dressler'],
  flashcard:   ['flashcard', 'flash card', 'card'],
};

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by','from',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','shall','that','this','these','those',
  'it','its','not','no','nor','if','as','so','then','than','when','where','which',
  'who','whom','what','how','any','all','each','both','more','most','very','also',
  // Conversational scaffolding. These carry no legal meaning, but they DO appear in
  // statute prose ("rules adopted under…", "may say…"), so leaving them in both
  // floods the candidate set and dilutes scoring — a plain-English question would
  // retrieve an administrative section that merely contains the words.
  'say','says','said','about','tell','explain','give','list','show','help','need',
  'want','mean','means','under','pursuant','according','regarding','concerning',
  'florida','fla','fl','state','law','laws','legal','statute','statutes',
]);

/** Score a lowercased haystack against a label keyword map; returns best key. */
function classify(haystack, map, fallback) {
  const text = haystack.toLowerCase();
  let best = fallback, bestScore = 0;
  for (const [key, words] of Object.entries(map)) {
    let score = 0;
    for (const w of words) {
      if (text.includes(w)) score += w.length > 3 ? 2 : 1;
    }
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

/**
 * Priority-ordered docType classifier. The old `classify()` picked whatever key
 * scored highest (and its fallback could silently mislabel files), so a file
 * with no strong token would drift to an arbitrary type. Here the first matching
 * type wins, and only a genuine syllabus/schedule token maps to 'syllabus'.
 */
const DOC_TYPE_PRIORITY = ['statute', 'syllabus', 'outline', 'case_brief', 'exam', 'notes', 'checklist', 'supplement', 'flashcard'];

/** A bare citation filename, e.g. "732.108.md" or "11.2421". */
const CITATION_NAME = /^\d+\.\d+[0-9a-z]*(\.md)?$/i;
/** A statute citation anywhere in a query, e.g. "732.108", "§ 733.106". */
const CITATION_IN_TEXT = /\b\d{3}\.\d{3,4}\b/;
const STATUTE_PATH = /florida-statutes|fla-stat|\bf\.s\./i;

function classifyDocType(haystack, fileName = '') {
  const text = String(haystack || '').toLowerCase();
  // Hard rule first: the statute reference corpus is identified by path or by a
  // bare-citation filename, neither of which the keyword scoring would catch.
  if (STATUTE_PATH.test(text) || CITATION_NAME.test(String(fileName || ''))) return 'statute';
  for (const key of DOC_TYPE_PRIORITY) {
    if ((DOC_TYPES[key] || []).some((w) => text.includes(w))) return key;
  }
  return 'notes'; // generic study document
}

/** Discipline classifier that surfaces which files land in the 'other' bucket. */
function classifyDiscipline(haystack) {
  const text = String(haystack || '');
  // Hard rule: statute files must never fall through to a course discipline just
  // because "estate"/"property"/"criminal" appear in a chapter name.
  if (STATUTE_PATH.test(text)) return 'florida_statutes';
  const result = classify(haystack, DISCIPLINES, 'other');
  if (result === 'other') console.warn('[ICM] discipline=other for:', haystack);
  return result;
}

/** True when the question is explicitly about a statute (citation or named source). */
function isStatuteQuery(query) {
  const q = String(query || '');
  return CITATION_IN_TEXT.test(q)
    || /florida statute|fla\.?\s*stat|\bf\.s\.\b/i.test(q)
    // "What does the law say about X" is the single most common way a student asks
    // for codified text, so it must count as naming the source.
    || /\b(the|state|florida)\s+law\b/i.test(q)
    || /\blaw\s+(say|says|said|require|requires|provide|provides|allow|allows|govern|governs)\b/i.test(q);
}

/* ── Statute weighting ────────────────────────────────────────────────────────
 * The previous design was a binary gate: isStatuteQuery() fired or nothing did, so
 * a plain-English question ("What does FL say about adopted persons?") got no
 * preferential treatment and her outline — which contains the same words in more
 * text — outranked the actual section. Weighting is now tiered and continuous:
 *   baseline   — this install is Florida-configured, so statutes are favoured anyway
 *   explicit   — the query names the source ("Fla. Stat.", "Florida statute", §)
 *   catchline  — the token appears in the section's own title (highest signal)
 *   citation   — an exact § match on the filename (decisive)
 * The baseline is deliberately small so a genuinely strong match in her own
 * materials (a case brief she asked to summarise) can still win.
 */
const DEFAULT_JURISDICTION = 'florida';
const STATUTE_BASELINE   = 10;
const STATUTE_EXPLICIT   = 15;   // + baseline == the previous flat +25
const STATUTE_CATCHLINE  = 20;
/** How much an adjacent phrase from the query found verbatim in the catchline is worth. */
const STATUTE_PHRASE = 40;

/**
 * Very light suffix folding, applied at SCORING time only. Scoring matches with
 * indexOf (substring), so folding "inheriting" to "inherit" lets one query token
 * reach inherit/inherits/inherited/inheritance, and "persons" reach "person".
 * Indexing and the inverted side-car keep raw tokens, so candidate generation is
 * unaffected and no rebuild is required.
 */
function foldToken(w) {
  if (w.length >= 5 && w.endsWith('ings')) return w.slice(0, -4);
  if (w.length >= 5 && w.endsWith('ing'))  return w.slice(0, -3);
  if (w.length >= 5 && w.endsWith('ed'))   return w.slice(0, -2);
  if (w.length >= 5 && w.endsWith('es'))   return w.slice(0, -2);
  if (w.length >= 4 && w.endsWith('s'))    return w.slice(0, -1);
  return w;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Adjacent pairs from the query found verbatim in the catchline. This is the
 * discriminating signal: "adopted persons" is § 732.108's catchline word for word,
 * whereas § 63.062 ("Persons required to consent to adoption") merely contains both
 * words apart. Separators allow an apostrophe-s so "attorney fees" also matches
 * "attorney's fees". Raw (unfolded) tokens are used because folding would break the
 * adjacency ("adopt" + "ed persons").
 */
function phrasePatterns(tokens) {
  const res = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i], b = tokens[i + 1];
    if (a.length < 3 || b.length < 3) continue;
    res.push(new RegExp(`\\b${escapeRe(a)}[\\s'\\u2019-]{1,3}${escapeRe(b)}`, 'i'));
  }
  return res;
}

function catchlinePhrase(catchline, patterns) {
  let hits = 0;
  for (const re of patterns) if (re.test(catchline)) hits++;
  return hits * STATUTE_PHRASE;
}

/** Split a file name into human tokens for topic hints. */
function topicsFromName(name) {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[\s_\-.–—()]+/)
    .map(t => t.trim())
    .filter(t => t.length > 3 && !STOP_WORDS.has(t.toLowerCase()))
    .slice(0, 6);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/* ── Text extraction (mirrors the IPC helpers) ──────────────────────────────── */

/**
 * Extract text from a PDF across both pdf-parse majors (v1 = bare function,
 * v2 = PDFParse class). Mirrors main.js → extractPdfText so the ICM indexer reads
 * PDFs correctly instead of throwing "pdfParse is not a function".
 */
/**
 * pdf-parse emits page-separator markers ("-- 1 of 3 --") even for pages with no
 * text layer; left in place they masquerade as content.
 */
function stripPdfPageArtifacts(text) {
  return String(text || '')
    .replace(/^[ \t]*-{2,}[ \t]*\d+[ \t]*of[ \t]*\d+[ \t]*-{2,}[ \t]*$/gm, '')
    .replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, '');
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mod = require('pdf-parse');

  if (mod && typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return stripPdfPageArtifacts(result && result.text);
    } finally {
      try { await parser.destroy(); } catch { /* already released */ }
    }
  }
  if (typeof mod === 'function') {
    const data = await mod(buffer, { max: 0 });
    return stripPdfPageArtifacts(data && data.text);
  }
  try {
    const legacy = require('pdf-parse/lib/pdf-parse.js');
    if (typeof legacy === 'function') {
      const data = await legacy(buffer, { max: 0 });
      return stripPdfPageArtifacts(data && data.text);
    }
  } catch { /* expected on v2 */ }

  throw new Error('Unrecognised pdf-parse export shape.');
}

async function extractText(filePath, ext) {
  try {
    if (ext === '.pdf') return await extractPdfText(filePath);
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn('[ICM] text extraction skipped for', path.basename(filePath), '-', err.message);
    return '';   // unreadable/binary — index the metadata anyway
  }
}

/* ── Index state ────────────────────────────────────────────────────────────── */

let _index = null;

function emptyIndex() {
  return { version: 1, updatedAt: null, roots: [], entries: [] };
}

function loadIndex() {
  if (_index) return _index;
  try {
    _index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(_index.entries)) _index = emptyIndex();
  } catch {
    _index = emptyIndex();
  }
  return _index;
}

function saveIndex() {
  const idx = loadIndex();
  idx.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx), 'utf8');
  } catch (err) {
    console.error('[ICM] Could not persist index:', err.message);
  }
  // Any mutation invalidates the inverted side-car; sync() rebuilds it, and
  // loadInverted() rebuilds lazily if a search happens first. Guarded so the real
  // index can never be deleted by a path collision.
  _inv = null;
  if (INVERTED_PATH !== INDEX_PATH) {
    try { fs.rmSync(INVERTED_PATH, { force: true }); } catch { /* ignore */ }
  }
  return idx;
}


/* ── Mirroring & indexing ───────────────────────────────────────────────────── */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-react', '.agents', '.claude']);
const DOC_EXTS  = new Set(['.pdf', '.docx', '.txt', '.md', '.rtf']);

function walk(root, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out, depth + 1);
    } else if (DOC_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Mirror + index a directory tree.
 *
 * "Mirror" = keep an entry per file (path, size, mtime, labels, extracted text) so
 * the corpus is reproducible from the user's own drive, and re-scanning is
 * incremental (unchanged files are reused, deleted files are dropped).
 */
async function sync(root = APP_DIR, { extract = true } = {}) {
  const idx = loadIndex();
  const byPath = new Map(idx.entries.map(e => [e.path, e]));
  const found = fs.existsSync(root) ? walk(root) : [];
  const seen = new Set();
  let added = 0, updated = 0, reused = 0;

  for (const filePath of found) {
    seen.add(filePath);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.size > MAX_FILE_MB * 1024 * 1024) continue;

    const prior = byPath.get(filePath);
    if (prior && prior.size === stat.size && prior.mtime === stat.mtimeMs) { reused++; continue; }

    const rel  = path.relative(root, filePath);
    const name = path.basename(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const hay  = `${rel} ${name}`;

    const text = extract ? (await extractText(filePath, ext)).slice(0, MAX_CHARS) : '';

    byPath.set(filePath, {
      path: filePath,
      rel,
      name,
      ext,
      size: stat.size,
      mtime: stat.mtimeMs,
      discipline: classifyDiscipline(hay),
      docType:    classifyDocType(hay, name),
      course: path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep)[0],
      topics: topicsFromName(name),
      catchline: statuteCatchline(text),
      chars: text.length,
      text,
    });
    prior ? updated++ : added++;
  }

  const entries = [...byPath.values()].filter(e => seen.has(e.path));
  idx.entries = entries;
  if (!idx.roots.includes(root)) idx.roots.push(root);
  saveIndex();
  try { buildInverted(); } catch (err) { console.warn('[ICM] inverted index skipped:', err.message); }

  return {
    root,
    scanned: found.length,
    added,
    updated,
    reused,
    removed: byPath.size - entries.length,
    indexed: entries.length,
  };
}

/** Index a single file (used when the app ingests a capture or a scan result). */
async function upsert(filePath, { extract = true } = {}) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return null; }
  const idx  = loadIndex();
  const name = path.basename(filePath);
  const ext  = path.extname(filePath).toLowerCase();
  const text = extract ? (await extractText(filePath, ext)).slice(0, MAX_CHARS) : '';

  // Label exactly as a full sync would: include the path relative to a known
  // mirror root (plus the parent folder) so a captured file in "Torts/" is
  // classified torts, not 'other'.
  const root = idx.roots.find(r => filePath.toLowerCase().startsWith(r.toLowerCase()));
  const rel  = root ? path.relative(root, filePath) : name;
  const hay  = `${rel} ${path.basename(path.dirname(filePath))} ${name}`;

  const entry = {
    path: filePath,
    rel,
    name,
    ext,
    size: stat.size,
    mtime: stat.mtimeMs,
    discipline: classifyDiscipline(hay),
    docType:    classifyDocType(hay, name),
    course: rel.includes(path.sep) ? rel.split(path.sep)[0] : '',
    topics: topicsFromName(name),
    catchline: statuteCatchline(text),
    chars: text.length,
    text,
  };
  idx.entries = idx.entries.filter(e => e.path !== filePath).concat(entry);
  saveIndex();
  return entry;
}

/* ── Retrieval (internal RAG over the student's own materials) ──────────────── */

function stats() {
  const idx = loadIndex();
  const byDiscipline = {};
  const byDocType = {};
  for (const e of idx.entries) {
    byDiscipline[e.discipline] = (byDiscipline[e.discipline] || 0) + 1;
    byDocType[e.docType] = (byDocType[e.docType] || 0) + 1;
  }
  return {
    root: APP_DIR,
    indexPath: INDEX_PATH,
    updatedAt: idx.updatedAt,
    files: idx.entries.length,
    indexedChars: idx.entries.reduce((n, e) => n + (e.chars || 0), 0),
    byDiscipline,
    byDocType,
  };
}

/** Cached lowercase searchable blob per entry (never persisted to the index JSON). */
function searchable(e) {
  if (e.__hay === undefined) {
    e.__hay = `${e.name} ${e.rel} ${e.discipline} ${e.docType} ${(e.topics || []).join(' ')} ${e.text || ''}`.toLowerCase();
  }
  return e.__hay;
}

/**
 * A statute file starts "# Fla. Stat. § 732.108 — Adopted persons and persons born
 * out of wedlock." The catchline after the em dash is the section's TITLE, which is
 * the highest-signal text a plain-English question can match.
 */
function statuteCatchline(text) {
  const m = /^#\s*Fla\.\s*Stat\.\s*§[^\n]*?—\s*(.+)$/m.exec(String(text || ''));
  return m ? m[1].trim() : '';
}

/** Catchline, memoised per entry. Falls back to deriving it from the stored body so
 *  entries indexed before the field existed (reused files) still get the boost. */
function catchlineOf(e) {
  if (e.__cl === undefined) {
    e.__cl = String(e.catchline || statuteCatchline(e.text) || '').toLowerCase();
  }
  return e.__cl;
}

/** Count non-overlapping occurrences without allocating an array (split() was the hot spot). */
function countOcc(hay, t) {
  let c = 0, i = hay.indexOf(t);
  while (i !== -1) { c++; i = hay.indexOf(t, i + t.length); }
  return c;
}

/* ── Inverted index (candidate pre-filter) ──────────────────────────────────────
 * A full linear scan costs ~300 ms p95 over 22k statute entries because scoring
 * counts token occurrences across every stored body. The inverted index maps a
 * token to the entry ids that contain it so scoring only touches real candidates.
 *
 * The path MUST never collide with INDEX_PATH: saveIndex() deletes the side-car and
 * buildInverted() overwrites it, so a collision would destroy the real index. A
 * custom ICM_INDEX_PATH (e.g. a test index) previously collapsed the two paths.
 */
const INVERTED_PATH = INDEX_PATH.toLowerCase().endsWith('icm-index.json')
  ? path.join(path.dirname(INDEX_PATH), 'icm-inverted.json')
  : INDEX_PATH.replace(/\.json$/i, '') + '.inverted.json';
if (INVERTED_PATH === INDEX_PATH) {
  throw new Error('[ICM] inverted-index path collides with the index path — refusing to start.');
}
/**
 * Cap on postings retained per token. This MUST stay well above the corpus size.
 * When it was 800 the lists filled in path order, so candidates were biased toward
 * alphabetically early titles (title-1 … title-33) and Title XLII (Estates and
 * Trusts) — the most relevant title for this user — was never even a candidate.
 * A capped list also cannot be distinguished from a genuinely rare one, which is
 * what made the bias invisible.
 */
const MAX_POSTINGS = 40000;
/**
 * Scored-candidate ceiling per query. Candidates are seeded rarest-token-first, so
 * the discriminating lists are always consumed whole and only the least relevant tail
 * is trimmed — which keeps worst-case latency down without costing recall.
 */
const MAX_CANDIDATES = 6000;
let _inv = null;

function loadInverted() {
  if (_inv) return _inv;
  try {
    _inv = new Map(Object.entries(JSON.parse(fs.readFileSync(INVERTED_PATH, 'utf8'))));
  } catch {
    // Missing/stale side-car (fresh install, or an upsert since the last sync):
    // rebuild from the current index so search never degrades to a full scan.
    try { return buildInverted(); } catch { _inv = new Map(); }
  }
  return _inv;
}

/** Rebuild the token -> [entryId] side-car from the current index. */
function buildInverted() {
  const idx = loadIndex();
  const map = Object.create(null);
  idx.entries.forEach((e, i) => {
    for (const t of new Set(tokenize(searchable(e)))) {
      const a = map[t] || (map[t] = []);
      if (a.length < MAX_POSTINGS) a.push(i);
    }
  });
  try { fs.writeFileSync(INVERTED_PATH, JSON.stringify(map), 'utf8'); } catch { /* cache only */ }
  _inv = new Map(Object.entries(map));
  return _inv;
}

/** Keyword-overlap retrieval over the mirrored index, with metadata boosts. */
function search(query, topK = 4, minScore = 1) {
  const idx = loadIndex();
  if (!idx.entries.length) return [];
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  // Statute questions outrank everything else: an explicit citation ("732.108",
  // "Fla. Stat. § 733.106") or a named-source phrase pins retrieval to the codified
  // text rather than to lecture notes that merely discuss it.
  const statuteQuery = isStatuteQuery(query);
  const cite = (String(query || '').match(CITATION_IN_TEXT) || [])[0] || null;

  // Narrow the pool: a citation query only needs the cited chapter, and otherwise
  // the inverted index supplies candidates. Falls back to a full scan when the
  // side-car index is empty (first run before sync)。
  const inv = loadInverted();
  // Inverse document frequency per token. A rare token ("inheriting") must outweigh a
  // common one ("children"), because it is the most specific word in a plain-English
  // question that identifies the right section. Document frequencies come free from the
  // postings lists, which are now complete (they were truncated before, which is why
  // this weighting was not possible).
  const N = idx.entries.length || 1;
  const weights = tokens.map((t) => {
    const list = inv.size ? inv.get(t) : null;
    const df = list && list.length ? list.length : 1;
    return Math.max(1, Math.log2(N / df));
  });
  // Compiled once per query, not once per candidate entry.
  const phrases = phrasePatterns(tokens);

  let pool;
  if (cite) {
    const chapterPrefix = cite.split('.')[0] + '.';
    const narrow = idx.entries.filter((e) => e.name === `${cite}.md` || e.rel.includes(chapterPrefix));
    pool = narrow.length >= topK ? narrow : null;
  }
  if (!pool) {
    if (inv.size) {
      const ids = new Set();
      // Rare tokens first. Now that postings are complete, a short list genuinely
      // means a rare token, so the discriminating tokens seed the candidate set and
      // common ones only top it up — instead of a cap silently biasing which titles
      // are reachable at all.
      const lists = tokens
        .map((t) => inv.get(t) || [])
        .filter((l) => l.length)
        .sort((a, b) => a.length - b.length);
      for (const list of lists) {
        for (const id of list) {
          ids.add(id);
          if (ids.size >= MAX_CANDIDATES) break;
        }
        if (ids.size >= MAX_CANDIDATES) break;
      }
      if (cite) idx.entries.forEach((e, i) => { if (e.name === `${cite}.md`) ids.add(i); });
      pool = ids.size ? [...ids].map((i) => idx.entries[i]).filter(Boolean) : [];
    } else {
      pool = idx.entries;
    }
  }

  const scored = pool.map((e) => {
    const hay = searchable(e);
    const isStatute = e.discipline === 'florida_statutes';
    const catchline = isStatute ? catchlineOf(e) : '';
    let score = 0;
    for (let ti = 0; ti < tokens.length; ti++) {
      const t = tokens[ti];
      const w = weights[ti];
      // Fold for matching so "inheriting" also reaches inherit/inherits/inherited.
      const f = foldToken(t);
      const matches = countOcc(hay, f);
      if (matches) score += Math.round(Math.min(matches, 12) * w);
      // Metadata hits are worth more than incidental body matches.
      if (e.name.toLowerCase().includes(t)) score += 4;
      if ((e.topics || []).some((x) => x.toLowerCase().includes(t))) score += 3;
      // The section's own title is the strongest signal a plain-English question can
      // hit — this is what lets "adopted persons" outrank notes about adoption.
      if (catchline && catchline.includes(f)) score += STATUTE_CATCHLINE * Math.min(w, 2);
    }
    if (e.docType === 'outline') score += 1;   // favour her own study artifacts

    if (isStatute && DEFAULT_JURISDICTION === 'florida') {
      score += STATUTE_BASELINE;
      if (statuteQuery) score += STATUTE_EXPLICIT;
      if (catchline) score += catchlinePhrase(catchline, phrases);
    }
    if (cite && e.name === `${cite}.md`) score += 500;   // exact section anchor

    return { entry: e, score };
  })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ entry, score }) => ({
    score,
    path: entry.path,
    rel: entry.rel,
    discipline: entry.discipline,
    docType: entry.docType,
    excerpt: (entry.text || '').slice(0, 1200),
  }));
}

/** Formatted context block injected into the AI system prompt. */
function getIcmContext(query, topK = 4) {
  let hits = [];
  try { hits = search(query, topK); } catch (err) {
    console.error('[ICM] search failed:', err.message);
    return '';
  }
  if (!hits.length) return '';

  const body = hits
    .map((h) => `[${h.discipline}/${h.docType}] ${path.basename(h.rel)}\n${h.excerpt}`)
    .join('\n\n---\n\n');

  return `\n\nSTUDENT'S OWN MATERIALS (ICM — mirrored from ${APP_DIR}; these OUTRANK the generic corpus. Prefer these authorities and quote them where relevant):\n\n${body}`;
}

function listEntries(limit = 200) {
  return loadIndex().entries.slice(0, limit).map((e) => ({
    rel: e.rel, discipline: e.discipline, docType: e.docType, chars: e.chars, path: e.path,
  }));
}

module.exports = { sync, upsert, search, getIcmContext, stats, listEntries, buildInverted, APP_DIR, INDEX_PATH, INVERTED_PATH, classify, classifyDocType, classifyDiscipline, isStatuteQuery, statuteCatchline, topicsFromName, tokenize, foldToken, phrasePatterns };

