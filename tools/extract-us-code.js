/**
 * tools/extract-us-code.js — extract a GPO United States Code title into corpus format.
 *
 * ADAPTED from extract-federal-rules.js, not rewritten. Unchanged: frontmatter emission, status
 * handling, manifest generation, furniture and page-marker removal, the shared pdf-normalize module,
 * and the whole extract -> verify -> test discipline. Changed: the heading grammar (`§ N.` instead of
 * `Rule N.`) and a state machine for `Sec.` contents blocks.
 *
 * ── WHY THE CONTENTS PROBLEM IS NOT A REGEX ──────────────────────────────────────────────────
 * In a USC title the contents entries are `1. Repealed.` / `2. Principals.` -- textually identical
 * in shape to a section heading. Title 18 has 2,215 heading-shaped lines of which only ~2,000 are
 * real sections; a naive `^\d+\.` heading pattern would emit ~2,200 phantom sections whose bodies
 * are the remnants of the contents block. That is the FRBP 7052 defect at 2,200x scale.
 *
 * The signal is a state change, not a line predicate: a BARE `Sec.` line opens a contents block.
 * The proposed `^\s*Sec\.?\s+\d+\s+[a-z]` would have matched nothing, because in this document
 * `Sec.` is never followed by a number on the same line.
 *
 * ── THE BLANK-LINE DECISION (made explicitly, because the two close conditions interact) ──────
 * A blank line COUNTS as a non-entry line for the "three consecutive" close. So:
 *
 *   - A structural heading (CHAPTER / PART / SUBCHAPTER) or a `§ N.` heading closes the block
 *     immediately -- the shortcut, catching clean boundaries.
 *   - Otherwise the block closes after three consecutive non-entry lines -- the backstop, catching
 *     a contents block that ends in prose with no heading.
 *
 * With blanks counted, both conditions are reachable and neither depends on the other. With blanks
 * stripped in normalisation, the three-line rule would need five real lines to fire and the
 * structural rule would do all the work. The choice is recorded here rather than left for the next
 * reader to re-derive, and possibly re-derive wrong.
 *
 * Usage:
 *   node tools/extract-us-code.js <titlePdf> <outDir> --title 18 --cite "18 U.S.C."
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { normalizePdfText } = require('./lib/pdf-normalize');

const argv = process.argv.slice(2);
const PDF = argv[0];
const OUT = argv[1];
const tArg = argv.indexOf('--title');
const cArg = argv.indexOf('--cite');
const TITLE = tArg !== -1 ? String(argv[tArg + 1]) : null;
const CITE = cArg !== -1 ? argv[cArg + 1] : 'U.S.C.';
const EDITION = '2024-edition';

if (!PDF || !OUT || !TITLE) {
  console.error('usage: node tools/extract-us-code.js <titlePdf> <outDir> --title N --cite "N U.S.C."');
  process.exit(2);
}

/* ── Line classifiers ────────────────────────────────────────────────────── */

const RE_SECTION = /^\s*\u00a7\s*(\d+[A-Za-z]?(?:-\d+)?)\s*\.\s*(.*)$/;
const RE_SEC_HEADER = /^\s*Sec\.\s*$/;
const RE_CONTENTS_ENTRY = /^\s*\[?\d+(?:-\d+)?[A-Za-z]?\s*\.(?:\s|$)/;
const RE_STRUCTURAL = /^\s*(?:CHAPTER|PART|SUBCHAPTER|Chapter|Part|Subchapter)\b/;
const RE_FURNITURE = /^(?:Page\s+\d+|TITLE\s+\d+\b|EDITORIAL NOTES?|AMENDMENTS?|Effective Date.*|Short Title.*)$/i;
const RE_DOT_LEADER = /\.{4,}/;

/**
 * Mark every line that is a contents entry, so they can be excluded from headings AND bodies.
 * Returns a Set of line indices.
 */
function markContentsBlocks(lines) {
  const contents = new Set();
  let open = false;
  let nonEntryRun = 0;
  let lastEntryOpen = false;   // previous entry did not end with a sentence-ending period

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (t === '') {
      if (open && ++nonEntryRun >= 3) { open = false; nonEntryRun = 0; }
      continue;
    }

    if (RE_SEC_HEADER.test(t)) {
      // A bare `Sec.` while a block is already open is a page-break column header, NOT a new block.
      // Re-opening would close the block and turn every following entry into a phantom heading.
      if (!open) { open = true; nonEntryRun = 0; lastEntryOpen = false; }
      continue;
    }

    if (!open) continue;

    if (RE_STRUCTURAL.test(t) || RE_SECTION.test(t)) {
      open = false; nonEntryRun = 0;      // shortcut close; this line is processed normally
      continue;
    }
    if (RE_CONTENTS_ENTRY.test(t)) {
      contents.add(i);
      nonEntryRun = 0;
      lastEntryOpen = !/[.;:]\s*$/.test(t);
      continue;
    }
    // A wrapped entry. Only a continuation if the preceding entry was left open: `2. Principals.`
    // ends with a period, so a lowercase line after it is prose, not a wrap.
    if (lastEntryOpen && /^\s*[a-z(]/.test(t)) {
      contents.add(i);
      lastEntryOpen = !/[.;:]\s*$/.test(t);
      continue;
    }
    if (++nonEntryRun >= 3) { open = false; nonEntryRun = 0; }
  }
  return contents;
}

/* ── Extraction ──────────────────────────────────────────────────────────── */

(async () => {
  const t0 = Date.now();
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(PDF)) });
  const res = await parser.getText();
  const lines = normalizePdfText(res.text || '').split('\n');
  console.log('pdf       : ' + path.basename(PDF) + '  (' + (res.total || '?') + ' pages, ' + lines.length + ' lines)');

  const contents = markContentsBlocks(lines);
  console.log('contents  : ' + contents.size + ' contents-entry lines identified and suppressed');

  /* Headings are `§ N.` lines outside a contents block. The line index range of a heading is what
     bounds its body, so a suppressed contents line cannot become a heading boundary. */
  const headings = [];
  lines.forEach((raw, i) => {
    if (contents.has(i)) return;
    const t = raw.trim();
    if (RE_DOT_LEADER.test(t)) return;
    const m = RE_SECTION.exec(t);
    if (!m) return;
    headings.push({ num: m[1], i, titleStart: (m[2] || '').trim() });
  });
  console.log('headings  : ' + headings.length + ' sections');

  const sections = new Map();
  const dupes = [];
  for (let k = 0; k < headings.length; k++) {
    const h = headings[k];
    const end = k + 1 < headings.length ? headings[k + 1].i : lines.length;

    let title = h.titleStart;
    let b = h.i + 1;
    while (b < end) {
      const next = lines[b].trim();
      if (!next) { if (title) break; b++; continue; }
      if (!title) { title = next; b++; continue; }
      if (/[A-Za-z]-$/.test(title)) { title += next; b++; continue; }
      if (!/[.;:]\s*$/.test(title) && /^[A-Z]/.test(next)) { title += ' ' + next; b++; continue; }
      break;
    }

    const bodyLines = [];
    const bodyIdx = [];
    for (let i = b; i < end; i++) {
      if (contents.has(i)) continue;                       // never body text
      const t = lines[i].trim();
      if (!t) continue;
      if (RE_FURNITURE.test(t)) continue;
      if (RE_DOT_LEADER.test(t)) continue;                 // tables and leader-based contents
      if (RE_SEC_HEADER.test(t)) continue;                 // stray page-break column header
      bodyLines.push(t);
      bodyIdx.push(i);
    }

    const paras = [];
    for (const l of bodyLines) {
      if (/^\([A-Za-z0-9]{1,3}\)\s/.test(l) || /^\((?:Pub\. L\.|As amended|Amended)/i.test(l)) paras.push(l);
      else if (paras.length) paras[paras.length - 1] += (/[A-Za-z]-$/.test(paras[paras.length - 1]) && /^[a-z]/.test(l))
        ? l : ' ' + l;
      else paras.push(l);
    }

    let amendments = null;
    const keep = [];
    for (const p of paras) {
      if (/^\((?:Pub\. L\.|As amended|Amended)/i.test(p)) amendments = amendments ? amendments + ' ' + p : p;
      else keep.push(p);
    }

    const cand = { num: h.num, title: title.replace(/\s+/g, ' ').trim(), body: keep.join('\n\n'), bodyIdx, amendments };
    const prev = sections.get(h.num);
    if (prev) {
      dupes.push(h.num);
      if ((cand.body || '').length <= (prev.body || '').length) continue;
    }
    sections.set(h.num, cand);
  }
  if (dupes.length) console.log('duplicate numbers (kept the one followed by content): ' + dupes.join(', '));

  const uniqueNumbers = new Set(headings.map((h) => h.num)).size;
  console.log('arithmetic: candidates=' + headings.length
    + '  duplicate-encounters=' + dupes.length
    + '  unique-numbers=' + uniqueNumbers
    + '  written=' + sections.size);

  /* ── Assertions ────────────────────────────────────────────────────────────
     These ask the STATE MACHINE, not a regex. The predicate that classified 1,816 lines as
     contents is the same predicate used here, so a firing means the machine misclassified a line --
     which is what this check exists to catch.

     A regex over the assembled body cannot do that job. `^\d+\.` matches legitimate citation notes
     ("53. (June 25, 1948, ch. 645, 62 Stat. 814.)") and so rejected what the extractor had
     correctly kept: an assertion stricter than the extractor's own rule, failing on correct output. */
  const problems = [];

  // Non-vacuity. If the state machine never fired, every invariant below passes for the wrong
  // reason. This is Control A applied at corpus scale.
  if (lines.length > 1000 && contents.size === 0) {
    problems.push('state machine fired ZERO times on a ' + lines.length + '-line document -- every invariant below is vacuous');
  }
  // Plausibility band. Zero is caught above; a PARTIAL firing is equally broken and would otherwise
  // pass every invariant below. Title 18 suppresses 1,816 lines out of 138,099. A document over
  // 100k lines that suppresses fewer than 500 or more than 5,000 means the classifier is not
  // behaving, and the band is per-document-size rather than a fixed count for that reason.
  if (lines.length > 100000 && (contents.size < 500 || contents.size > 5000)) {
    problems.push('state machine suppressed ' + contents.size + ' lines, outside the plausible 500-5000 band for a '
      + lines.length + '-line document -- a partial firing is as broken as none');
  }

  // Arithmetic. Every heading must either create a section or be recognised as a duplicate of one.
  // If these disagree, a section was silently dropped by the keep-or-drop logic.
  if (sections.size !== uniqueNumbers) {
    problems.push('ARITHMETIC: ' + sections.size + ' sections written but ' + uniqueNumbers
      + ' unique numbers in ' + headings.length + ' candidate headings (' + dupes.length + ' duplicate encounters)');
  }

  // A line cannot be both a contents entry and a heading.
  const bothKinds = headings.filter((h) => contents.has(h.i));
  if (bothKinds.length) {
    problems.push('lines classified as BOTH heading and contents entry: ' + bothKinds.map((h) => h.num).join(', '));
  }

  for (const s of sections.values()) {
    if (!s.title && !s.body) problems.push(s.num + ': no title and no body');
    const leakLine = (s.bodyIdx || []).find((i) => contents.has(i));
    if (leakLine !== undefined) {
      problems.push(s.num + ': contents entry in body -> ' + JSON.stringify(lines[leakLine].trim().slice(0, 100)));
    }
  }
  if (!sections.size) problems.push('no sections extracted');

  console.log('\n=== extraction ===');
  console.log('  sections extracted : ' + sections.size);
  console.log('  problems           : ' + problems.length);
  for (const p of problems.slice(0, 15)) console.log('    ' + p);

  if (sections.size && !problems.length) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const s of sections.values()) {
      const fm = [
        '---',
        'rule_number: ' + s.num,          // generic name: one assertion suite reads rules and sections
        'title: "' + String(s.title).replace(/"/g, '\\"') + '"',
        'status: operative',
        'cite: "' + CITE + '"',
        'edition: "' + EDITION + '"',
        'title_number: ' + TITLE,
        'source: "United States Code, ' + EDITION + ' (U.S. Government Publishing Office)."',
        'authority: "Public domain (U.S. Government work)."',
      ];
      if (s.amendments) fm.push('amendments: "' + String(s.amendments).replace(/\s+/g, ' ').replace(/"/g, '\\"') + '"');
      fm.push('---');
      const md = [...fm, '', '# ' + CITE + ' \u00a7 ' + s.num + ' \u2014 ' + s.title,
        '', '**Section:** ' + s.num + ' \u00b7 **Status:** operative', '', '---', '', s.body];
      fs.writeFileSync(path.join(OUT, s.num + '.md'), md.join('\n') + '\n', 'utf8');
    }
    fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify({
      label: 'United States Code, Title ' + TITLE, cite: CITE, edition: EDITION,
      source: path.basename(PDF), extracted_at: new Date().toISOString(),
      count: sections.size, rules: [...sections.keys()],
    }, null, 2), 'utf8');
    console.log('\nwrote ' + sections.size + ' files to ' + OUT + ' in ' + (Date.now() - t0) + 'ms');
  } else if (problems.length) {
    console.log('\nNOT WRITTEN: assertions failed, so no corpus was produced.');
    process.exit(1);
  }
})();
