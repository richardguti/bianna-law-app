/**
 * tools/lib/classify.js — v2.0.0 — the ONE source of truth for what a line is.
 *
 * Ten false verdicts in one cycle, every one from tooling. The structural cause: the extractor and
 * the verifier each carried their own idea of what a line was. The extractor's was right, the
 * verifier's was a pattern list that lagged it, and containment failed on correct output for 1,120
 * sections. Reimplementation is how that happens (instance 8).
 *
 * So classification lives here, once. Both consumers call classifyDocument() and act on the same
 * spans. A consumer with its own pattern list is not using this module, and the Control C invariant
 * will not hold.
 *
 *   classifyDocument(lines, profile) -> Array<{ kind, start, end }>   // one entry per line
 *   classify(lines, i, profile)      -> { kind, start, end }          // convenience, O(n)
 *
 * kind is a closed enum: heading | contents-entry | cross-reference-table | editorial-notes |
 * amendments | effective-date | short-title | furniture | body. start/end are inclusive line
 * indices; for line-extent kinds they equal the line index.
 *
 * The heading GRAMMAR legitimately differs between document families (`§ N.` in the Code, `Rule N.`
 * in the rule prints). That is a named profile argument, not a per-consumer pattern list -- both
 * consumers pass the same profile name and get identical results.
 *
 * Bump VERSION on any behavioural change. Corpora record the classifier version that produced them,
 * so a corpus and the classifier able to reproduce it stay linked.
 */
'use strict';

const VERSION = '2.0.0';

const KINDS = ['heading', 'contents-entry', 'cross-reference-table', 'editorial-notes',
  'amendments', 'effective-date', 'short-title', 'furniture', 'body'];

/* Line-extent furniture: a match covers that line and nothing else. */
const FURNITURE = [
  { name: 'ruledoc-page-marker', re: /^--\s*\d+\s+of\s+\d+\s*--$/ },
  { name: 'page-number', re: /^Page\s+\d+$/i },
  { name: 'title-line', re: /^TITLE\s+\d+\b/i },
  { name: 'rule-running-head', re: /^FEDERAL RULES OF [A-Z ]+$/ },
  { name: 'rule-running-head-2', re: /^\d*\s*Rule\s+\d+[A-Za-z]*\s+FEDERAL RULES OF [A-Z][A-Z ]+$/ },
  { name: 'bare-sec', re: /^Sec\.$/i },
  { name: 'dot-leader', re: /\.{4,}/ },
];

/* Block labels: a match opens a span running until a blank line or a heading. */
const BLOCKS = [
  { kind: 'editorial-notes', re: /^Editorial Notes$/i },
  { kind: 'amendments', re: /^Amendments?$/i },
  { kind: 'effective-date', re: /^Effective Date\b/i },
  { kind: 'short-title', re: /^Short Title\b/i },
];

const PROFILES = {
  'us-code': {
    heading: /^\s*\u00a7\s*\d+[A-Za-z]?(?:-\d+)?\s*\./,
    structural: /^\s*(?:CHAPTER|PART|SUBCHAPTER|Chapter|Part|Subchapter)\b/,
    contentsHeader: /^\s*Sec\.\s*$/,
    contentsEntry: /^\s*\[?\d+(?:-\d+)?[A-Za-z]?\s*\.(?:\s|$)/,
    crossRefRow: /\t/,
  },
  'federal-rules': {
    heading: /^Rule\s+\d{1,4}[A-Za-z]?\.\s*/,
    structural: /^\s*(?:APPENDIX|SUPPLEMENTAL RULES|PART [A-Z])\b/,
    contentsHeader: null,
    contentsEntry: /^Rule\s+\d{1,4}[A-Za-z]?\.\s/,
    crossRefRow: /\t/,
  },
};

function profile(name) {
  const p = PROFILES[name];
  if (!p) {
    throw new Error('classify: unknown profile ' + JSON.stringify(name) +
      ' (known: ' + Object.keys(PROFILES).join(', ') + ')');
  }
  return p;
}

/** Words that may appear lower-cased inside an otherwise title-cased heading. */
const CONNECTORS = new Set(['and', 'or', 'of', 'the', 'in', 'to', 'for', 'on', 'by', 'a', 'an',
  'as', 'at', 'with', 'from', 'that', 'not']);

/**
 * Is this line a heading continuation, or the start of the rule/section text?
 *
 * The two are told apart by case, which is reliable in these documents: headings are title-cased
 * ("Accessory After the Fact"), bodies are sentence-cased ("Whoever, knowing that an offense...").
 * Without this the heading swallows the first line of body prose and the section is truncated.
 */
function looksTitleCased(line) {
  const t = String(line).trim();
  if (!t) return false;
  if (/^\(/.test(t)) return false;
  if (/^\(?(?:Pub\. L\.|As amended|Amended)/i.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  return words.every((w) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (!bare) return true;
    return /^[A-Z]/.test(bare) || CONNECTORS.has(bare.toLowerCase());
  });
}

/**
 * Classify every line in two passes over one definition of each kind.
 *
 * Pass 1 runs the contents state machine, because a contents entry is only identifiable relative to
 * the block it sits in: `1. Repealed.` is an entry inside a `Sec.` block and a heading-shaped line
 * outside one. That is the distinction a per-line regex cannot make.
 *
 * Pass 2 classifies what is left: headings, block labels, furniture, cross-reference rows.
 */
function classifyDocument(lines, profileName) {
  const p = profile(profileName);
  const out = lines.map(() => ({ kind: 'body', start: -1, end: -1 }));

  /* ── Pass 1: contents blocks ─────────────────────────────────────────────
     A bare `Sec.` opens a block. A bare `Sec.` WHILE one is open is a page-break column header,
     not a new block -- re-opening would close it and turn every following entry into a phantom
     heading. The block closes on a structural heading or a real heading (shortcut), or after three
     consecutive non-entry lines counting blanks (backstop). A lowercase line continues the previous
     entry only if that entry was left open, i.e. did not end with a sentence-ending period. */
  let open = false;
  let nonEntryRun = 0;
  let lastEntryOpen = false;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (t === '') {
      if (open && ++nonEntryRun >= 3) open = false;
      continue;
    }
    if (p.contentsHeader && p.contentsHeader.test(t)) {
      if (!open) { open = true; nonEntryRun = 0; lastEntryOpen = false; }
      out[i] = { kind: 'furniture', start: i, end: i };
      continue;
    }
    if (!open) continue;

    if (p.structural.test(t) || p.heading.test(t)) { open = false; nonEntryRun = 0; continue; }
    if (p.contentsEntry.test(t)) {
      out[i] = { kind: 'contents-entry', start: i, end: i };
      nonEntryRun = 0;
      lastEntryOpen = !/[.;:]\s*$/.test(t);
      continue;
    }
    if (lastEntryOpen && /^\s*[a-z(]/.test(t)) {
      out[i] = { kind: 'contents-entry', start: i, end: i };
      lastEntryOpen = !/[.;:]\s*$/.test(t);
      continue;
    }
    if (++nonEntryRun >= 3) open = false;
  }

  /* ── Pass 2: headings, block labels, furniture ─────────────────────────── */
  for (let i = 0; i < lines.length; i++) {
    if (out[i].kind !== 'body') continue;      // settled by pass 1
    const t = lines[i].trim();
    if (t === '') continue;

    const blk = BLOCKS.find((b) => b.re.test(t));
    if (blk) {
      let e = i;
      for (let j = i + 1; j < lines.length; j++) {
        const u = lines[j].trim();
        if (u === '') break;
        if (out[j].kind !== 'body') break;
        if (p.heading.test(u) || p.structural.test(u)) break;
        e = j;
      }
      for (let k = i; k <= e; k++) out[k] = { kind: blk.kind, start: i, end: e };
      continue;
    }

    if (p.heading.test(t)) {
      let e = i;
      let title = t;
      for (let j = i + 1; j < lines.length; j++) {
        const u = lines[j].trim();
        if (u === '') break;
        if (out[j].kind !== 'body') break;
        if (p.heading.test(u) || p.structural.test(u)) break;
        // A heading ending in a hyphen is split mid-word: the next line continues it whatever its
        // case. Otherwise only a title-cased line continues a heading -- "Whoever, knowing that an
        // offense has been committed" is body prose, and treating it as a title truncated the
        // section and made Control B fail.
        if (/[A-Za-z]-$/.test(title) || looksTitleCased(u)) { e = j; title = u; continue; }
        break;
      }
      for (let k = i; k <= e; k++) out[k] = { kind: 'heading', start: i, end: e };
      continue;
    }

    if (FURNITURE.some((f) => f.re.test(t))) { out[i] = { kind: 'furniture', start: i, end: i }; continue; }
    if (p.crossRefRow && p.crossRefRow.test(lines[i])) {
      out[i] = { kind: 'cross-reference-table', start: i, end: i };
      continue;
    }
  }

  return out;
}

/** Convenience accessor. Recomputes the document -- prefer classifyDocument for bulk use. */
const classify = (lines, i, profileName) => classifyDocument(lines, profileName)[i];

/**
 * The single normalisation used by every consumer for comparison. Whitespace, every hyphen form,
 * and the typographic quotes are folded, so reflow and collation cannot cause a false mismatch.
 *
 * This deliberately does NOT strip furniture -- that is the classifier's job, and keeping the two
 * separate is what stops a comparison from quietly defining its own view of the document
 * (instance 10).
 */
function normaliseForComparison(text) {
  return String(text)
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\s\u00ad\u2010-\u2015-]+/g, '')
    .toLowerCase();
}

module.exports = {
  VERSION, KINDS, PROFILES, FURNITURE, BLOCKS,
  classifyDocument, classify, normaliseForComparison,
};
