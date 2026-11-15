/**
 * tools/extract-nxt.js — rebuild the statute corpus from the Legislature's own library.
 *
 * WHY THIS EXISTS
 * ---------------
 * The bundled corpus is a scrape, and a scrape that went wrong: 34.88% of files carry a
 * fragment of the adjacent section appended to their body, and some are missing subsections
 * outright. § 732.601 in the bundle is missing the tail of (3) and the whole of (4). Every
 * offline agent inherits those defects, so the corpus is rebuilt from source.
 *
 * THE CONTAINER
 * -------------
 * fs2026.nxt is a Rocket Infobase (U2), not a text file. Inside it each section is a complete
 * XHTML 1.0 Transitional document:
 *
 *   <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ...>
 *     <title>F.S. 732.603</title>
 *     <span class="SectionNumber">732.603</span>
 *     <span class="CatchlineText"><CATCHLINE>Antilapse; deceased devisee; class gifts.</CATCHLINE>
 *     <SECBODY> ... subsections ... </SECBODY>
 *     <div class="History">...<HISTORY>s. 1, ch. 74-106; ...</HISTORY></div>
 *     <div class="Note">...<NOTES>Created from former s. 736.05.</NOTES></div>
 *   </body></html>
 *
 * A record is therefore bounded by DOCTYPE and </body></html>, and identified by its own
 * embedded <title>. Segmentation NEVER relies on adjacency or byte offsets -- record order in
 * the container is not document order, which is what broke the original scrape. The original
 * tool evidently assumed the next record in the file was the next section; it is not.
 *
 * FRAMING BYTES
 * -------------
 * Infobase interleaves its own framing into the stored value, always adjacent to markup and
 * never inside prose:
 *
 *   <title>F.S. 102.071\x137\x08</title>            <- trailing framing after the content
 *   <span class="SectionNumber">\x08102.071\x15...  <- leading framing before the content
 *
 * The framing carries a printable digit, so stripping control bytes alone would turn
 * "F.S. 102.071" into "F.S. 102.0717". Cleaning therefore removes a control run *together with*
 * an adjacent digit run, and only then drops any remaining high bytes (the source encodes all
 * non-ASCII as entities, so a raw high byte can only be framing).
 *
 * Usage:
 *   node tools/extract-nxt.js <fs2026.nxt> <outDir> [chapterFilter]
 *   node tools/extract-nxt.js fs2026.nxt ../jsons/references/florida-statutes-2026
 *   node tools/extract-nxt.js fs2026.nxt ./tmp 732          # one chapter, test mode
 */
'use strict';

const fs = require('fs');
const path = require('path');

const NXT = process.argv[2] || 'F:\\Bianna - Law\\Bianna-Law-Final\\FLDL-\\2026DL\\fs2026.nxt';
const OUT = process.argv[3] || path.join(__dirname, '..', 'jsons', 'references', 'florida-statutes-2026');
const ONLY_CHAPTER = process.argv[4] || null;   // e.g. '732' to test one chapter first

/* ── Cleaning ────────────────────────────────────────────────────────────── */

// Control bytes, excluding tab/newline/carriage-return, which are real whitespace.
const CTRL = '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]';

function clean(s) {
  return String(s || '')
    // 1. A control run, plus any digit run welded to it. This is the framing signature.
    .replace(new RegExp(CTRL + '+(?:\\d+' + CTRL + '*)?', 'g'), '')
    // 2. A digit run immediately preceding a control run.
    .replace(new RegExp('\\d*' + CTRL + '+', 'g'), '')
    // 3. Whatever high bytes are left are framing: the source entity-encodes all non-ASCII.
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/<[^>]*>/g, '')
    // Non-breaking and typographic spaces are ordinary spacing in statute text (&#160;, em and
    // en space). Decoding them to a plain space avoids carrying invisible characters into the
    // corpus, where they break byte-for-byte comparisons.
    .replace(/&#x0*0*A0;|&#160;|&#xA0;/gi, ' ')
    .replace(/&#x2002;|&#x2003;|&#8194;|&#8195;/g, ' ')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t\u2003]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Body text only: the subsection containers, in document order. */
function bodyOf(rec) {
  const s = rec.indexOf('<SECBODY');
  const e = rec.indexOf('<div class="History"');
  const span = rec.slice(s === -1 ? 0 : s, e === -1 ? rec.length : e);
  // Subsection markers live in <span class="Number">, e.g. ".(2)........9.&#x2003;". Re-anchor
  // them to the start of a line so "(2)" reads as a marker rather than as loose text.
  return clean(span)
    .replace(/^\(?([0-9a-z]{1,3})\)\s*/i, '($1) ')
    .replace(/\n\(?([0-9]{1,2})\)\s*/g, '\n($1) ');
}

function inner(rec, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(rec);
  return m ? clean(m[1]) : null;
}

/* ── Extraction ──────────────────────────────────────────────────────────── */

console.log('source : ' + NXT);
console.log('output : ' + OUT);
if (ONLY_CHAPTER) console.log('filter : chapter ' + ONLY_CHAPTER + ' only (test mode)');

const t0 = Date.now();
const buf = fs.readFileSync(NXT);
console.log('read   : ' + buf.length + ' bytes in ' + (Date.now() - t0) + 'ms');

const DOCTYPE = Buffer.from('<!DOCTYPE html');
const END = Buffer.from('</body></html>');

const files = new Map();          // section -> markdown
const problems = [];
let records = 0, inScope = 0, skipped = 0, duplicates = 0, multiBody = 0;

// A record boundary is the next DOCTYPE, NOT the next </body></html>. Truncated records have
// no </body></html> at all, so terminating on it merges record pairs and halves the yield
// (13,886 records found instead of 26,383, losing 54 of chapter 732's 90 sections).
const offsets = [];
for (let i = 0; ; ) {
  const p = buf.indexOf(DOCTYPE, i);
  if (p === -1) break;
  offsets.push(p);
  i = p + DOCTYPE.length;
}
console.log('record starts          : ' + offsets.length);

for (let r = 0; r < offsets.length; r++) {
  const rec = buf.subarray(offsets[r], r + 1 < offsets.length ? offsets[r + 1] : buf.length).toString('latin1');
  records++;

  // A record holding more than one <SECBODY> holds more than one section; only the first is
  // reachable through this record's <title>. Counted so the report states the size of the gap.
  const bodies = (rec.match(/<SECBODY/gi) || []).length;
  if (bodies > 1) multiBody++;

  // Identify the record by its OWN title, never by position.
  const titleSect = (/<title>[\s\S]{0,20}?F\.S\.\s*(\d+\.\d+)/.exec(rec) || [])[1] || null;
  const spanSect = (/<span class="SectionNumber">[\s\S]{0,30}?(\d+\.\d+)/.exec(rec) || [])[1] || null;
  if (!titleSect) { skipped++; continue; }
  if (ONLY_CHAPTER && !titleSect.startsWith(ONLY_CHAPTER + '.')) continue;
  inScope++;

  // ASSERTION 1: title and SectionNumber must agree, or the record is misidentified.
  if (spanSect && spanSect !== titleSect) {
    problems.push(titleSect + ': title/section mismatch (title=' + titleSect + ' span=' + spanSect + ')');
    continue;
  }

  // Completeness: a record that a container boundary cut in half has no </SECBODY> or no
  // </body></html>. Such a record is kept only if no complete copy of the section exists.
  const hasBody = rec.indexOf('<SECBODY') !== -1;
  const hasBodyEnd = rec.indexOf('</SECBODY') !== -1;
  const hasClose = rec.indexOf('</body></html>') !== -1;

  // Confine every field to THIS section. 2,713 of 26,383 records hold more than one section,
  // and a head-dropped continuation carries a <CATCHLINE> but no <SectionNumber> -- so the next
  // CATCHLINE is a section boundary too. Without this the body runs into the next section and
  // takes its History with it, reproducing the exact splice defect being repaired.
  const secIdx = [...rec.matchAll(/<span class="SectionNumber">/g)].map((m) => m.index);
  const catIdx = [...rec.matchAll(/<CATCHLINE>/g)].map((m) => m.index);
  const closeIdx = rec.indexOf('</body></html>');
  const bounds = [];
  if (secIdx.length > 1) bounds.push(secIdx[1]);
  if (catIdx.length > 1) bounds.push(catIdx[1]);
  if (closeIdx !== -1) bounds.push(closeIdx);
  const slice = rec.slice(0, bounds.length ? Math.min.apply(null, bounds) : rec.length);

  const catchline = inner(slice, 'CATCHLINE');
  const history = inner(slice, 'HISTORY');
  const note = inner(slice, 'NOTES');
  const body = bodyOf(slice);

  // ASSERTION 5: the section's own metadata must not be another section's. The body must not
  // contain a catchline remnant, which is what a splice looks like once tags are stripped.
  if (/CatchlineText|<\/?(span|div|html|body|head|title)\b/i.test(body)) {
    problems.push(titleSect + ': body still contains markup or a catchline remnant');
    continue;
  }

  // ASSERTION 2: a section with no body is not a section.
  if (!body || body.length < 40) {
    problems.push(titleSect + ': body too short (' + (body || '').length + ')');
    continue;
  }

  // ASSERTION 3: cleaning left nothing behind that cannot appear in a statute.
  if (new RegExp(CTRL).test(body)) { problems.push(titleSect + ': control byte survived cleaning'); continue; }
  if (/[^\x09\x0A\x0D\x20-\x7E\u00A7\u2014\u2018\u2019\u201C\u201D\u2026\u00A0]/.test(body)) {
    problems.push(titleSect + ': unexpected character survived cleaning');
    continue;
  }

  // ASSERTION 4: no neighbour's marker was spliced in -- the exact defect being repaired.
  const foreign = new RegExp('F\\.S\\.\\s*(?!' + titleSect.replace('.', '\\.') + ')\\d').exec(body);
  if (foreign) { problems.push(titleSect + ': contains a foreign F.S. marker'); continue; }

  const lines = [
    '# Fla. Stat. \u00a7 ' + titleSect + ' \u2014 ' + (catchline || '(no catchline)') + '.',
    '',
    '**Section:** ' + titleSect,
    '**Source:** 2026 Florida Statutes (FLLawDL2026)',
    '',
    '---',
    '',
    body,
  ];
  if (history) lines.push('', '**History:** ' + history);
  if (note) lines.push('', '**Note:** ' + note);
  const md = lines.join('\n') + '\n';

  // Completeness beats length: a truncated fragment can be long and still be cut off.
  const score = (hasBody ? 1000000 : 0) + (hasBodyEnd ? 500000 : 0) + (hasClose ? 250000 : 0) + (history ? 10000 : 0) + (note ? 5000 : 0) + body.length;
  const prev = files.get(titleSect);
  if (prev) {
    duplicates++;
    if (prev.score >= score) continue;
  }
  files.set(titleSect, { score, md });
}

console.log('\n=== extraction ===');
console.log('  records found          : ' + records);
console.log('  in scope (' + (ONLY_CHAPTER || 'all') + ') : ' + inScope);
console.log('  skipped (not a section): ' + skipped);
console.log('  duplicate records      : ' + duplicates + ' (a section stored more than once; best copy kept)');
console.log('  records with 2+ bodies : ' + multiBody + ' (a record holding more than one section)');
console.log('  sections extracted     : ' + files.size);
console.log('  problems               : ' + problems.length);
for (const p of problems.slice(0, 25)) console.log('    ' + p);
if (problems.length > 25) console.log('    ... and ' + (problems.length - 25) + ' more');

/* ── Write ───────────────────────────────────────────────────────────────── */

if (files.size) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [section, v] of files) fs.writeFileSync(path.join(OUT, section + '.md'), v.md, 'utf8');
  console.log('\nwrote ' + files.size + ' files to ' + OUT);
}

// Machine-readable summary, consumed by tools/diff-corpus.js and the regeneration report.
const summary = {
  source: NXT,
  chapter: ONLY_CHAPTER || 'all',
  records,
  inScope,
  skipped,
  extracted: files.size,
  problems: problems.length,
  problemSamples: problems.slice(0, 50),
  seconds: Math.round((Date.now() - t0) / 1000),
};
fs.writeFileSync(path.join(__dirname, '..', 'nxt-extract-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log('summary  : nxt-extract-summary.json');
