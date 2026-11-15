/**
 * tools/verify-federal-rules.js — verify an extracted rule corpus against its source PDF.
 *
 * WHY THIS EXISTS
 * ---------------
 * Spot-checking four rules out of 430 is a sanity check, not a verification. This is the
 * mechanical version: re-read the source PDF, then assert for EVERY rule file that its body
 * appears in the source as a contiguous run of characters, ignoring whitespace and hyphenation.
 *
 * Two independent checks, because they fail differently:
 *
 *   1. CONTAINMENT. The extracted body must exist in the source, in order. Whitespace, line
 *      breaks, soft hyphens and collation hyphens are normalised away on both sides, so reflow
 *      cannot cause a false failure -- but a dropped clause, an invented word, or text belonging
 *      to a neighbouring rule cannot pass.
 *
 *   2. SMALL-CAPS CANDIDATES. The PDF's typesetter renders some words in small caps, and the text
 *      layer can emit them with an internal space ("E NFORCE" for ENFORCE). This classifies every
 *      candidate using a dictionary built from the corpus's own lower-case words: if the joined
 *      form is a word the corpus uses elsewhere, the space is a defect; if it is not a word, the
 *      candidate is a false positive such as a possessive ("COURT'S STATEMENT") or a legitimate
 *      token ("A RESPONSIVE PLEADING").
 *
 * Usage:
 *   node tools/verify-federal-rules.js <corpusDir> <sourcePdf>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DIR = process.argv[2];
const PDF = process.argv[3];
const DIAGNOSE = process.argv.includes('--diagnose');
if (!DIR || !PDF) { console.error('usage: node tools/verify-federal-rules.js <corpusDir> <sourcePdf> [--diagnose]'); process.exit(2); }

/**
 * Remove the page furniture from the SOURCE before comparing.
 *
 * This is essential and was the first bug in this tool: the extractor deletes running heads and
 * page markers from a rule's body, so a source that still contains them can never contain the
 * body as a substring. Both sides must be reduced to the same text or the comparison is
 * meaningless -- which is exactly what a 0-in-65 pass rate looks like.
 *
 * The patterns are deliberately CASE-SENSITIVE. An earlier version used the `i` flag, which made
 * `[A-Z ]` match lower-case letters too, so the pattern swallowed the remainder of the sentence
 * after any in-text reference to the rule set's own name. That deleted real content from the
 * source and made 15 rules look like extractor drift when they were perfect. Running heads are
 * printed in full capitals; references inside rule text are not.
 */
function stripFurniture(text) {
  return String(text)
    // Rule prints
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, ' ')
    .replace(/\b\d*\s*Rule\s+\d+[A-Za-z]*\s+FEDERAL RULES OF [A-Z][A-Z ]+/g, ' ')
    .replace(/\bFEDERAL RULES OF [A-Z ]+/g, ' ')
    // USC prints. The extractor removes these from bodies, so the source must be reduced the same
    // way or every body looks non-contiguous -- the same class of mistake as the missing ASCII
    // hyphen. Any new furniture rule in an extractor needs its counterpart here.
    .replace(/^\s*Page\s+\d+\s*$/gm, ' ')
    .replace(/^\s*TITLE\s+\d+\u2014[A-Za-z ,\-]+$/gm, ' ')
    .replace(/^\s*Sec\.\s*$/gm, ' ')
    .replace(/^.*\.{4,}.*$/gm, ' ')
    // MINIMAL CHANGE, hypothesis test only. The extractor also drops these four label lines from
    // bodies, so the source must drop them too or containment fails on correct output. NOTE: this
    // makes the two sides equivalent for the LABEL only -- the notes prose that follows each label
    // remains in both, so containment passing here does NOT mean the bodies are free of editorial
    // text. See tools/README.md; the extent-based shared module is the real fix.
    .replace(/^\s*EDITORIAL NOTES?\s*$/gmi, ' ')
    .replace(/^\s*AMENDMENTS?\s*$/gmi, ' ')
    .replace(/^\s*Effective Date.*$/gmi, ' ')
    .replace(/^\s*Short Title.*$/gmi, ' ');
}

/**
 * Collapse everything that legitimately differs between the PDF's text layer and the extracted
 * corpus: whitespace of every kind, soft hyphens, and the hyphens inserted to break a word at a
 * line end. Also fold the typographic characters the extractor repairs.
 */
function norm(s) {
  return stripFurniture(String(s))
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    // Every hyphen and dash form, INCLUDING the plain ASCII hyphen. Missing the ASCII case is what
    // made this tool report 0 of 65: the extractor de-hyphenates "com-\npilation" to "compilation"
    // while the source keeps "com-pilation", so the two could never be equal.
    .replace(/[\s\u00ad\u2010\u2011\u2012\u2013\u2014\u2015-]+/g, '')
    .toLowerCase();
}

/** The one string the extractor adds inside a body: the amendments label. Not source text. */
function stripFormatMarkers(body) {
  return String(body).replace(/\*\*Amendments:\*\*\s*/g, '');
}

/** Frontmatter between the first two delimiters; body after the third. */
function parseRuleFile(text) {
  const lines = String(text).split('\n');
  if (lines[0].trim() !== '---') return null;
  const fm = {};
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }
  let j = i + 1;
  for (; j < lines.length && lines[j].trim() !== '---'; j++) { /* skip the human header */ }
  const body = lines.slice(j + 1).join('\n').trim();
  return { fm, body };
}

(async () => {
  const t0 = Date.now();
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(PDF)) });
  const res = await parser.getText();
  const source = norm(res.text || '');

  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
  let passed = 0, empty = 0, failed = 0;
  const failures = [];
  const bodies = [];

  for (const f of files) {
    const parsed = parseRuleFile(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!parsed) { failed++; failures.push(f + ': no parseable frontmatter'); continue; }
    if (parsed.fm.status === 'abrogated') { empty++; continue; }
    const b = norm(parsed.body);
    if (!b) { empty++; continue; }
    bodies.push({ f, body: parsed.body });
    if (source.includes(b)) passed++;
    else {
      failed++; failures.push(f + ': body not found in source PDF');
      if (DIAGNOSE) {
        // Longest prefix of the body that IS in the source. Where it stops is where the mismatch
        // is, and whether the text after it exists anywhere in the source distinguishes a tool
        // problem (the text is there, contiguity broke) from an extractor problem (the text is
        // not there at all).
        let lo = 0, hi = b.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (source.includes(b.slice(0, mid))) lo = mid; else hi = mid - 1;
        }
        const tail = b.slice(lo, lo + 45);
        const verdict = !tail ? 'body is a prefix of the source (window problem)'
          : source.includes(tail) ? 'TOOL: text is in the source but not contiguously'
            : 'EXTRACTOR: this text is absent from the source';
        console.log('  ' + f.padEnd(10) + ' matched ' + String(lo).padStart(6) + '/' + String(b.length).padEnd(6) + verdict);
        console.log('      extracted near divergence : ' + JSON.stringify(b.slice(Math.max(0, lo - 45), lo + 55)));
        const anchor = b.slice(Math.max(0, lo - 30), lo);
        const at = anchor ? source.indexOf(anchor) : -1;
        console.log('      source near that point    : ' + JSON.stringify(at === -1 ? '(anchor not located)' : source.slice(at + anchor.length, at + anchor.length + 110)));
      }
    }
  }

  /* ── Small-caps candidate classification ─────────────────────────────────── */

  // A dictionary of the words this corpus actually uses, taken from lower-case text (which the
  // small-caps typesetting never touches), so it is independent of the defect being measured.
  const vocab = new Set();
  for (const { body } of bodies) {
    for (const w of body.toLowerCase().matchAll(/[a-z]{2,}/g)) vocab.add(w[0]);
  }

  // A standalone capital that is not A or I and not preceded by an apostrophe. The apostrophe
  // exclusion removes possessives like "COURT'S STATEMENT", which are correct text.
  const candidates = new Map();
  for (const { f, body } of bodies) {
    for (const m of body.matchAll(/(?<![A-Za-z'\u2019])([B-HJ-Z])\s([A-Z]{2,})\b/g)) {
      const joined = (m[1] + m[2]).toLowerCase();
      const key = m[0];
      const rec = candidates.get(key) || { count: 0, joined, isWord: vocab.has(joined), files: [] };
      rec.count++;
      if (rec.files.length < 3) rec.files.push(f);
      candidates.set(key, rec);
    }
  }
  const real = [...candidates.entries()].filter(([, v]) => v.isWord);
  const spurious = [...candidates.entries()].filter(([, v]) => !v.isWord);

  console.log('corpus      : ' + path.basename(DIR));
  console.log('source      : ' + path.basename(PDF));
  console.log('rules       : ' + files.length + '   (abrogated/empty: ' + empty + ')');
  console.log('containment : ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) for (const x of failures.slice(0, 15)) console.log('    FAIL ' + x);
  console.log('small-caps  : ' + real.length + ' REAL defect(s), ' + spurious.length
    + ' false positive(s), from ' + candidates.size + ' candidate form(s)');
  for (const [k, v] of real) console.log('    REAL "' + k + '" -> "' + v.joined + '" x' + v.count + '  e.g. ' + v.files.join(', '));
  if (spurious.length) {
    console.log('    not defects (joined form is not a word this corpus uses): '
      + spurious.map(([k]) => '"' + k + '"').join(' '));
  }
  console.log('elapsed     : ' + (Date.now() - t0) + 'ms');
  process.exit(failed ? 1 : 0);
})();
