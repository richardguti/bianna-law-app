/**
 * tools/lib/pdf-normalize.js — the ONE place PDF text is repaired.
 *
 * Both extractors import this. A copied map drifts: the rule extractor learns an entry from a
 * future edition and the USC extractor never hears about it.
 *
 * ── WHAT IS ACTUALLY IN THE DATA (measured) ──────────────────────────────────────────────────
 * A codepoint histogram of the GPO Title 18 PDF (93,206 non-ASCII characters, 6.04 M chars total)
 * shows runs that decode to single legitimate codepoints: U+00A7 (§), U+2013 (–), U+2014 (—),
 * U+2018 and U+2019 (' and '), U+00A5 (¥), U+00B0 (°), U+2044 (⁄). There are NO multi-character
 * mojibake sequences in the extracted text. The same holds for the December 2024 Judicial
 * Conference rule prints.
 *
 * So for these sources the mappings below are INERT. They are kept because (a) mojibake is real for
 * other sources -- the Florida .nxt scrape carries a literal 'â€”' -- (b) a future print edition may
 * change its typesetting pipeline, and (c) an unmapped sequence corrupts citations, while a mapped
 * one that never fires costs nothing.
 *
 * ── BEFORE ADDING AN ENTRY ───────────────────────────────────────────────────────────────────
 * Run the histogram probe, not a grep. Terminal rendering of UTF-8 as cp1252 is the most common
 * false positive in this repository: six instances so far, including one where seven mappings were
 * proposed for sequences that do not exist. If the count comes from a console, it is not evidence.
 * Add an entry only when the histogram shows a MULTI-codepoint sequence.
 */
'use strict';

const MOJIBAKE = [
  // Observed in the Florida .nxt scrape (genuine), retained as a safety net for other sources.
  ['\u00e2\u20ac\u201d', '\u2014'],   // â€” -> em dash
  ['\u00e2\u20ac\u009d', '\u201d'],   // â€   -> right double quote
  ['\u00e2\u20ac\u009c', '\u201c'],   // â€œ -> left double quote
  ['\u00e2\u20ac\u2122', '\u2019'],   // â€™ -> right single quote
  ['\u00e2\u20ac\u02dc', '\u2018'],   // â€˜ -> left single quote
  ['\u00c2\u00a0', ' '],              // nbsp
  ['\u00c2\u00a7', '\u00a7'],         // Â§ -> section
];

/** Repair text extracted from a PDF or a legacy container. Pure; never throws. */
function normalizePdfText(text) {
  let out = String(text == null ? '' : text);
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good);
  return out;
}

module.exports = { normalizePdfText, MOJIBAKE };
