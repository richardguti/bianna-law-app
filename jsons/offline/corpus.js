/**
 * corpus.js — guarded, verbatim reads from the bundled Florida Statutes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The offline agents make one promise: an offline answer is *retrieved*, never generated, so
 * it cannot hallucinate. That promise is only as good as the corpus underneath it, and the
 * corpus is demonstrably imperfect:
 *
 *   732.102.md carries the beginning of § 732.101 appended to its own text:
 *     "...the entire intestate estate.
 *      F.S. 732.1016732.101
 *      Intestate estate.
 *      ——
 *      (1) Any part of the estate of a decedent not effectively disposed of by will passes..."
 *
 * A full scan of the bundle found a foreign `F.S. <section>` marker inside the body of
 * 8,605 of 24,668 numbered files (34.88%). That is not a citation error; it is the *next
 * section's opening* spliced onto this one. Serving that as "verbatim § 732.102" would make
 * the offline mode confidently wrong, which is worse than being unavailable.
 *
 * So every read is validated, the contaminated tail is cut at the marker, and the record
 * carries what was found so the UI can say so. Nothing here invents text — it only removes
 * text that provably belongs to another section.
 *
 * The longer-term fix is corpus regeneration from fs2026.nxt (docs/CORPUS-DEFECTS.md); this
 * guard is what makes the offline mode safe to ship before that lands.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── Location ────────────────────────────────────────────────────────────── */

/**
 * The corpus ships inside app.asar at references/florida-statutes, and lives at the same
 * relative path in the dev tree, so one candidate covers both. The ICM copy is the fallback
 * main.js already uses for its own corpus reads.
 */
function corpusRoot() {
  const candidates = [
    path.join(__dirname, '..', 'references', 'florida-statutes'),
    path.join(__dirname, '..', '..', 'icm', 'references', 'florida-statutes'),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* try next */ }
  }
  return null;
}

/* ── Section numbers ─────────────────────────────────────────────────────── */

/** "732.102", "Fla. Stat. § 732.102", "s. 732.102" all yield "732.102". */
function normalizeSection(input) {
  const m = /(\d{1,4}\.\d{1,5})/.exec(String(input || ''));
  return m ? m[1] : null;
}

/** The digits that start a section — used to tell a file's own marker from a neighbour's. */
function sectionStem(section) {
  return String(section).replace(/\./g, '');
}

function sectionPath(section) {
  const root = corpusRoot();
  if (!root) return null;
  // A section may live under any title-N-... directory; the filename is the section number.
  const file = section + '.md';
  for (const dir of fs.readdirSync(root)) {
    const p = path.join(root, dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ── Verified overlay ────────────────────────────────────────────────────── */
/*
 * A per-section repair layer that sits ON TOP of the bundled corpus.
 *
 * The bundle is read-only (it ships inside app.asar) and it is a scrape, so parts of it are
 * demonstrably wrong. Rather than replacing 24,670 files, a section that has been checked against
 * flsenate.gov is written here, and every read prefers it. The overlay is small, inspectable, and
 * reversible: deleting the directory reverts the app to the bundled copy with no other change.
 *
 * The root is injected by main.js (Electron's userData directory) because this module is plain
 * Node and must not depend on Electron. SLP_CORPUS_OVERLAY overrides it, which is what the tests
 * use so they never touch a real install.
 */
let overlayRoot = null;

function setOverlayRoot(dir) { overlayRoot = dir || null; }

function overlayDir() {
  return overlayRoot || process.env.SLP_CORPUS_OVERLAY || null;
}

function overlayPath(section) {
  const d = overlayDir();
  return d ? path.join(d, section + '.md') : null;
}

function overlayMetaPath(section) {
  const d = overlayDir();
  return d ? path.join(d, section + '.meta.json') : null;
}

/** { verified_at, source_url, hash, edition } or null. Never throws. */
function readOverlayMeta(section) {
  const p = overlayMetaPath(section);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** True when a verified copy of this section is present. */
function hasOverlay(section) {
  const p = overlayPath(section);
  return !!(p && fs.existsSync(p));
}

/**
 * Write a verified copy. Returns the paths written, or throws with a `code` so the IPC layer can
 * report the failure instead of pretending the repair happened.
 */
function writeOverlay(section, markdown, meta = {}) {
  const d = overlayDir();
  if (!d) { const e = new Error('no overlay directory configured'); e.code = 'no_overlay_root'; throw e; }
  const s = normalizeSection(section);
  if (!s) { const e = new Error('unparseable section number'); e.code = 'bad_section'; throw e; }
  fs.mkdirSync(d, { recursive: true });
  const mdPath = overlayPath(s);
  const metaPath = overlayMetaPath(s);
  const record = {
    section: s,
    verified_at: meta.verified_at || new Date().toISOString(),
    source_url: meta.source_url || null,
    edition: meta.edition || null,
    hash: meta.hash || null,
    written_at: new Date().toISOString(),
  };
  fs.writeFileSync(mdPath, markdown, 'utf8');
  fs.writeFileSync(metaPath, JSON.stringify(record, null, 2), 'utf8');
  return { markdown_path: mdPath, meta_path: metaPath, meta: record };
}

/** Everything that has been verified, newest first. Powers the corpus-health panel. */
function overlayStatus() {
  const d = overlayDir();
  if (!d || !fs.existsSync(d)) return { root: d, count: 0, sections: [] };
  const sections = fs.readdirSync(d)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .map((s) => {
      const m = readOverlayMeta(s) || {};
      return { section: s, verified_at: m.verified_at || null, source_url: m.source_url || null, edition: m.edition || null };
    })
    .sort((a, b) => String(b.verified_at || '').localeCompare(String(a.verified_at || '')));
  return { root: d, count: sections.length, sections };
}

/** Remove a verified copy, reverting that section to the bundle. */
function clearOverlay(section) {
  const s = normalizeSection(section);
  if (!s) return false;
  let removed = false;
  for (const p of [overlayPath(s), overlayMetaPath(s)]) {
    if (p && fs.existsSync(p)) { fs.unlinkSync(p); removed = true; }
  }
  return removed;
}

/* ── Integrity guard ─────────────────────────────────────────────────────── */

/**
 * Find `F.S. <digits>` markers in a body and decide which are foreign.
 *
 * The source document writes each section's header as `F.S. 732.101`, so a marker whose
 * digits do not begin with this section's own digits can only have come from a neighbour that
 * was spliced in. The concatenation in the evidence (`732.1016732.101`) is the neighbour's
 * number, a fragment, then the neighbour's number again — so a prefix test is the right test.
 */
function detectForeignMarkers(body, section) {
  const own = sectionStem(section);
  const out = [];
  for (const m of body.matchAll(/F\.S\.\s*(\d[\d.]*)/g)) {
    const digits = String(m[1]).replace(/\./g, '');
    if (!digits.startsWith(own)) out.push({ raw: m[0], index: m.index });
  }
  return out;
}

/** A catchline that carries chapter/part scaffolding is corrupt, not a title. */
function catchlineIsCorrupt(catchline) {
  return /CHAPTER\s+\d+\s*PART/i.test(catchline)
      || /\b\d{3}\.\d{3,}\b/.test(catchline)
      || /^\s*$/.test(catchline || '');
}

/* ── Parsing ─────────────────────────────────────────────────────────────── */

function field(meta, label) {
  const m = new RegExp('\\*\\*' + label + ':\\*\\*\\s*(.+)').exec(meta);
  return m ? m[1].trim() : null;
}

/** Em-spaces and ragged wrapping are source formatting, not content. */
function cleanBody(body) {
  return body
    .replace(/\u2003/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Read one section verbatim, refusing to pass on text that belongs to another section.
 *
 * Returns { found: false } when the section is not bundled, so callers can say so rather
 * than substituting something approximate.
 */
function readSection(sectionInput, knownDefects) {
  const section = normalizeSection(sectionInput);
  if (!section) return { found: false, reason: 'unparseable section number' };

  // A verified copy wins over the bundle. That is the entire point of the overlay.
  const overlayFile = hasOverlay(section) ? overlayPath(section) : null;
  let file = overlayFile || sectionPath(section);
  if (!file) return { found: false, section, reason: 'not in the bundled corpus' };

  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    // A damaged or half-written overlay must not take the section down with it.
    if (overlayFile) {
      const bundled = sectionPath(section);
      if (bundled) { try { raw = fs.readFileSync(bundled, 'utf8'); file = bundled; } catch { /* fall through */ } }
    }
    if (raw === null) return { found: false, section, reason: 'unreadable: ' + err.message };
  }
  const overlaid = !!overlayFile && file === overlayFile;

  const cut = raw.indexOf('\n---\n');
  const meta = cut === -1 ? raw : raw.slice(0, cut);
  let body = cut === -1 ? '' : raw.slice(cut + 5);

  const firstLine = raw.split('\n')[0].replace(/^#\s*/, '');
  // "# Fla. Stat. § 732.102 — Spouse's share of intestate estate."
  const catchline = (firstLine.split('\u2014').slice(1).join('\u2014') || '').trim()
    || firstLine.replace(/^Fla\.\s*Stat\.?\s*/i, '').trim();

  const anomalies = [];

  // 1. Foreign section text spliced onto the tail.
  const foreign = detectForeignMarkers(body, section);
  if (foreign.length) {
    body = body.slice(0, foreign[0].index);
    anomalies.push('tail_contaminated');
  }

  body = cleanBody(body);

  // 2. A catchline that leaked chapter/part scaffolding instead of a title.
  if (catchlineIsCorrupt(catchline)) anomalies.push('catchline_corrupt');

  // 3. Empty or near-empty body: nothing to quote.
  if (body.length < 40) anomalies.push('body_too_short');

  // 4. Previously confirmed wrong content, carried so the answer can say so.
  const known = knownDefects && knownDefects[section];

  // Where this text came from. The UI turns this into the authority line on every citation, so a
  // repaired copy can say when it was checked and an unverified one can say it was not.
  const ovMeta = overlaid ? readOverlayMeta(section) : null;

  return {
    found: true,
    section,
    catchline: known && known.catchline ? known.catchline : catchline,
    title: field(meta, 'Title'),
    chapter: field(meta, 'Chapter'),
    part: field(meta, 'Part'),
    source: field(meta, 'Source'),
    history: field(meta, 'History'),
    note: field(meta, 'Note'),
    body,
    file: overlaid
      ? 'corpus-overlay/' + section + '.md'
      : path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'),
    provenance: overlaid
      ? {
          origin: 'overlay',
          verified_at: (ovMeta && ovMeta.verified_at) || null,
          source_url: (ovMeta && ovMeta.source_url) || null,
          hash: (ovMeta && ovMeta.hash) || null,
        }
      : { origin: 'bundle', verified_at: null, source_url: null, hash: null },
    integrity: {
      ok: anomalies.length === 0 && !known,
      anomalies,
      trimmedForeigMarkers: foreign.map((f) => f.raw),
      knownDefect: known || null,
    },
  };
}

function readSections(sections, knownDefects) {
  return (sections || []).map((s) => readSection(s, knownDefects)).filter((r) => r.found);
}

/* ── Enumeration (used by tests to validate the doctrine map) ────────────── */

/** Every section present for a chapter, e.g. '732' -> ['732.101', '732.102', ...]. */
function listSections(chapter) {
  const root = corpusRoot();
  if (!root) return [];
  const prefix = String(chapter) + '.';
  const out = [];
  for (const dir of fs.readdirSync(root)) {
    const full = path.join(root, dir);
    let entries;
    try { entries = fs.readdirSync(full); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const stem = name.slice(0, -3);
      if (stem.startsWith(prefix)) out.push(stem);
    }
  }
  return out.sort((a, b) => {
    const [, an = '0'] = a.split('.');
    const [, bn = '0'] = b.split('.');
    return Number(an) - Number(bn);
  });
}

/* ── Catchline search (no index needed, so it works before icm.sync ever runs) ───── */

/**
 * Query -> content tokens, shared by both catchline searches.
 *
 * Dots are kept *inside* a token so a citation like "732.601" survives, but stripped from the
 * edges: "Define ademption." was otherwise tokenised as "ademption." which never matches the
 * catchline "Ademption by satisfaction.", so the term search silently ranked by list order.
 */
function tokensOf(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.§-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-§]+/, '').replace(/[.\-§]+$/, ''))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Rank a KNOWN set of sections (a doctrine's own list) by how well each catchline matches the
 * query. Without this, the doctrine's first-listed section was always chosen, so "define
 * ademption" returned whichever section happened to be listed first rather than § 732.609, the
 * ademption provision. A corrupt catchline is scored down: it is not evidence of relevance.
 */
function rankSections(query, sections) {
  const tokens = tokensOf(query);
  const ranked = (sections || []).map((s) => {
    const p = sectionPath(s);
    let catchline = '';
    try { catchline = (fs.readFileSync(p, 'utf8').split('\n')[0].split('\u2014').slice(1).join('\u2014') || '').trim(); }
    catch { /* unreadable: leave the catchline empty */ }
    const hay = catchline.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += t.length >= 6 ? 3 : 2;
    // A catchline that *opens* with the queried term is the section that defines it:
    // "Ademption by satisfaction" beats "Nonademption of specific devises" for "ademption".
    if (tokens.some((t) => hay.startsWith(t + ' '))) score += 2;
    if (catchlineIsCorrupt(catchline)) score -= 2;
    return { section: s, catchline, score, i: 0 };
  });
  ranked.forEach((r, i) => { r.i = i; });
  // Tiebreak on the curator's own order, which was chosen deliberately.
  return ranked
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => ({ section: r.section, catchline: r.catchline, score: r.score }));
}


/**
 * Rank a chapter set's sections against a query using catchlines, which are the highest-signal
 * short text in the corpus ("Adopted persons and persons born out of wedlock"). This is
 * deliberately independent of the ICM index: offline mode must work on a machine where the
 * index has never been built, and scoping to an agent's chapters keeps it to a few hundred
 * file reads rather than the whole 24,670.
 */
function searchCatchlines(query, chapters, limit = 5) {
  const tokens = tokensOf(query);
  if (!tokens.length) return [];

  const scopes = Array.isArray(chapters) ? chapters : [chapters];
  const scored = [];
  for (const chapter of scopes) {
    for (const section of listSections(chapter)) {
      const p = sectionPath(section);
      if (!p) continue;
      let first;
      try { first = fs.readFileSync(p, 'utf8').split('\n')[0]; } catch { continue; }
      const catchline = (first.split('\u2014').slice(1).join('\u2014') || '').trim();
      if (!catchline) continue;
      const hay = catchline.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += t.length >= 6 ? 3 : 2;
      }
      if (score > 0) scored.push({ section, catchline, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.section.localeCompare(b.section)).slice(0, limit);
}

const STOPWORDS = new Set(['the', 'what', 'does', 'say', 'says', 'about', 'florida', 'fla',
  'statute', 'statutes', 'law', 'under', 'and', 'for', 'with', 'that', 'this', 'how', 'are',
  'can', 'you', 'give', 'tell', 'explain', 'define', 'meaning', 'definition', 'is', 'of',
  'in', 'to', 'a', 'an', 'it', 'do', 'why', 'when', 'which', 'who']);

module.exports = {
  corpusRoot, normalizeSection, sectionStem, sectionPath,
  readSection, readSections, listSections, searchCatchlines, rankSections, tokensOf,
  detectForeignMarkers, catchlineIsCorrupt, cleanBody,
  // verified overlay (repair layer that sits on top of the read-only bundle)
  setOverlayRoot, overlayDir, overlayPath, overlayMetaPath, readOverlayMeta,
  hasOverlay, writeOverlay, overlayStatus, clearOverlay,
};

