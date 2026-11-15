/**
 * tools/extract-federal-rules.js — extract the Judicial Conference rule sets into corpus format.
 *
 * WHY THIS EXISTS
 * ---------------
 * The offline agents could only ever cite Florida statutes, with two consequences:
 *
 *   - Evidence had no primary text at all. The FRE are federal; the bundle is Florida. Offline
 *     mode returned nothing for "what does Rule 404 say", and the Florida analogues are close but
 *     not identical, so substituting § 90.404 silently would have been a subtly wrong answer.
 *   - Civ Pro and Crim Pro had no rules. FRCP 12(b)(6) and 1.510 cannot be answered from a
 *     statute book.
 *
 * The Judicial Conference publishes these rule sets as U.S. Government publications:
 *
 *   federal-rules-of-evidence-dec-1-2024_0.pdf          (this file's target)
 *   federal-rules-of-civil-procedure-dec-1-2024_0.pdf
 *   federal-rules-of-criminal-procedure-dec-1-2024_0.pdf
 *   federal-rules-of-bankruptcy-procedure-dec-1-2024_0.pdf
 *
 * They are **public domain** — works of the U.S. Government — so unlike a casebook, a Restatement
 * or the Bluebook, they can ship inside the app. That distinction is the whole reason this is
 * possible: the primary law is free, the commentary is not.
 *
 * THE PDF'S STRUCTURE, WHICH IS NOT OBVIOUS
 * -----------------------------------------
 *   1. Front matter (cover, committee roster, foreword) and a table of contents. TOC lines carry
 *      dot leaders and must be skipped, or every rule is emitted twice with a sentence-case title.
 *   2. Body headings are Title Case on one or two lines: `Rule 105. Limiting Evidence That Is Not
 *      Admissible Against Other` / `Parties or for Other Purposes`.
 *   3. A heading can be split across a hyphen break: `...or Pre-` / `disposition`.
 *   4. Page furniture intrudes mid-sentence: `-- 17 of 44 --` and running heads like
 *      `3      Rule 201        FEDERAL RULES OF EVIDENCE`.
 *   5. Prose is hyphen-collated at line ends (`evi-` / `dence`), so line joins must de-hyphenate.
 *   6. The extractor emits cp1252-mangled punctuation (`ΓÇÖ` where the PDF has `’`) — the same
 *      class of encoding damage the Florida corpus carries.
 *
 * Usage:
 *   node tools/extract-federal-rules.js <pdf> <outDir> --label "Federal Rules of Evidence" --cite "Fed. R. Evid."
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const argv = process.argv.slice(2);
const PDF = argv[0];
const OUT = argv[1];
const labelArg = argv.indexOf('--label');
const citeArg = argv.indexOf('--cite');
const edArg = argv.indexOf('--edition');
const LABEL = labelArg !== -1 ? argv[labelArg + 1] : 'Federal Rules';
const CITE = citeArg !== -1 ? argv[citeArg + 1] : 'Fed. R.';

/**
 * The edition a corpus was taken from, so two editions can coexist. The source filenames carry it
 * (`...-dec-1-2024_0.pdf`), and without it in the output path the December 2025 edition would
 * silently overwrite the 2024 one and the app could never say which it was quoting.
 */
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function editionFromFilename(f) {
  const m = /([a-z]{3})-(\d{1,2})-(\d{4})/i.exec(path.basename(String(f)));
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? m[3] + '-' + mm + '-' + String(m[2]).padStart(2, '0') : null;
}
const EDITION = edArg !== -1 ? String(argv[edArg + 1]) : (editionFromFilename(PDF) || 'undated');

if (!PDF || !OUT) {
  console.error('usage: node tools/extract-federal-rules.js <pdf> <outDir> [--label "..."] [--cite "..."]');
  process.exit(2);
}

/* ── Text repair ─────────────────────────────────────────────────────────── */

// Text repair is shared: see tools/lib/pdf-normalize.js for what is (and is not) in the data.
const { normalizePdfText } = require('./lib/pdf-normalize');

function repair(s) {
  // Rule prints split some small-caps words: "IN GENERAL" arrives as "I N GENERAL". That is a
  // typesetting artifact specific to these documents, so it lives here rather than in the shared
  // normalizer.
  return normalizePdfText(s).replace(/\bI\s+N(?=\s+[A-Z])/g, 'IN');
}

/** Page furniture and running heads are not part of any rule. */
function isFurniture(line, label) {
  const t = line.trim();
  if (!t) return false;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(t)) return true;
  if (new RegExp('^\\d+\\s+Rule\\s+\\d+\\w*\\s+' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(t)) return true;
  if (new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(t)) return true;
  return false;
}

/**
 * Is this heading-looking line the start of a RULE, or a table-of-contents entry?
 *
 * Case is not a safe discriminator: the FRE print has a sentence-cased TOC, but the FRCP, FRCrP
 * and FRBP prints have title-cased TOCs that are indistinguishable from body headings by shape.
 * What actually differs is what FOLLOWS the line. A body heading is followed by rule text -- a
 * subsection marker or ordinary prose. A TOC entry is followed by another entry, a dot leader, or
 * a page number. So the test is content-based, not typographic.
 */
function looksLikeBodyHeading(lines, i, label) {
  const ahead = [];
  for (let j = i + 1; j < lines.length && ahead.length < 3; j++) {
    const t = lines[j].trim();
    if (!t) continue;
    if (isFurniture(lines[j], label)) continue;
    ahead.push(t);
  }
  if (!ahead.length) return false;
  const next = ahead[0];
  if (/^Rule\s+\d/.test(next)) return false;      // next entry of the contents list
  if (/\.{4,}/.test(next)) return false;          // dot leader
  if (/^\d{1,3}$/.test(next)) return false;       // page number
  if (/^\([A-Za-z0-9]{1,3}\)/.test(next)) return true;   // subsection marker: it is the rule
  return /[a-z]{3}/.test(next);                   // ordinary prose (title continuations have too)
}

/** Running heads appear mid-line at page breaks, not only on their own line. */
function stripInlineFurniture(line, label) {
  const L = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = String(line);
  out = out.replace(new RegExp('(?:^|[\\t]|\\s{2,})\\d*\\s*Rule\\s+\\d+\\w*\\s+' + L + '(?:$|[\\t]|\\s{2,})', 'gi'), ' ');
  out = out.replace(new RegExp('(?:^|[\\t]|\\s{2,})' + L + '(?:$|[\\t]|\\s{2,})', 'gi'), ' ');
  return out;
}

/**
 * An abrogated rule is still a rule. FRCP Rules 74-76 (magistrate appeals) and 84 (Forms) were
 * abrogated, and their headings survive in the print with the abrogation note as the entire body.
 * Treating that as a defect would drop them, and then the contents list, which still lists them,
 * would disagree with the extraction.
 */
function isAbrogationOnly(s) {
  return /\[?\s*\(?\s*(?:abrogated|reserved|removed|transferred|redesignated)/i.test(String(s || ''));
}

/** Small connectors that appear lower-cased inside an otherwise title-cased heading. */
const CONNECTORS = new Set(['and', 'or', 'of', 'the', 'in', 'to', 'for', 'on', 'by', 'a', 'an',
  'as', 'at', 'with', 'from', 'that', 'not']);

/**
 * Is this line part of a heading, or the start of the rule's text?
 *
 * The two are told apart by case, which is reliable in these PDFs: headings are title-cased
 * ("Parties or for Other Purposes"), bodies are sentence-cased ("If the court admits evidence that
 * is admissible against a party"). Sentence case always contains a lower-cased word outside the
 * connector set.
 */
function looksLikeHeadingContinuation(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^\(/.test(t)) return false;                       // subsection marker
  if (/^\(As amended|^\(Amended|^\(Pub\. L\./i.test(t)) return false;
  if (/^\d+\.$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;                    // headings are short
  return words.every((w) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (!bare) return true;
    return /^[A-Z]/.test(bare) || CONNECTORS.has(bare.toLowerCase());
  });
}

/** Join a hyphen-collated line pair: "evi-" + "dence" -> "evidence". */
function joinLines(prev, next, allCaps) {
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) return prev.slice(0, -1) + next;

  // All-caps subsection headings are not hyphenated by the PDF's typesetter, so a word broken
  // across lines arrives as a bare fragment: "(c) CO" / "URT'S", "(b) ADVERSE PA" / "ARTY'S",
  // "(a) C" / "RITERIA". Rejoin without a space. The discriminator is that "A" and "I" are the
  // only single-letter words in English -- a lone A or I is an article, anything else is a
  // fragment. Joining is only attempted while the paragraph is still entirely upper-case, which
  // is what keeps this off ordinary prose.
  if (allCaps) {
    const lastWord = (prev.match(/([A-Za-z]+)$/) || [])[1] || '';
    const isArticle = lastWord.length === 1 && /^[AI]$/.test(lastWord);
    if (lastWord && !isArticle && /^[A-Z]/.test(next)) return prev + next;
  }
  return prev + ' ' + next;
}

/**
 * A within-line small-caps split: the extractor emits "(a) C RITERIA" for "CRITERIA". Restricted
 * to the first word after a subsection marker, because that is the only position where a lone
 * non-A/I capital is unambiguously a fragment rather than a legitimate token like "TITLE V".
 */
function fixMarkerSplit(p) {
  return String(p).replace(/^(\([A-Za-z0-9]{1,3}\)\s+)([B-HJ-Z])\s+([A-Z]{3,})\b/, (m, mk, a, b) => mk + a + b);
}

/** True while nothing lower-case has appeared, i.e. still inside an all-caps heading. */
function isAllCapsSoFar(s) { return !/[a-z]/.test(String(s)); }

/* ── Extraction ──────────────────────────────────────────────────────────── */

(async () => {
  const t0 = Date.now();
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(PDF)) });
  const res = await parser.getText();
  const raw = repair(res.text || '');
  const lines = raw.split('\n').map((l) => repair(l));
  console.log('pdf      : ' + path.basename(PDF));
  console.log('pages    : ' + (res.total || '?') + '   chars: ' + raw.length + '   lines: ' + lines.length);

  /* Headings come in two flavours and must not be confused. A TOC entry wraps without dot leaders
     on its first line, so dot-leader detection alone is not enough -- but TOC entries are
     sentence-cased while body headings are title-cased, and that separates them reliably. */
  /* Candidates are every heading-shaped line; deciding which are the contents list is a separate
     question. Finding the body's start once is robust where a per-line test is not: consecutive
     abrogated rules (74-76, 84) have no text between their headings, so each looked like a
     contents entry because the next line was another heading. Everything before the body's first
     real heading is the contents list; everything after it is body. */
  const candidates = [];
  lines.forEach((rawLine, i) => {
    const t = rawLine.trim();
    const m = /^Rule\s+(\d{1,4}[A-Za-z]?)\.\s*(.*)$/.exec(t);
    if (!m) return;
    candidates.push({ num: m[1], i, titleStart: (m[2] || '').trim(), dots: /\.{4,}/.test(t) });
  });

  let bodyStartLine = Infinity;
  for (const c of candidates) {
    if (!c.dots && looksLikeBodyHeading(lines, c.i, LABEL)) { bodyStartLine = c.i; break; }
  }

  const tocNumbers = new Set();
  const headings = [];
  for (const c of candidates) {
    if (c.dots || c.i < bodyStartLine) { tocNumbers.add(c.num); continue; }
    headings.push(c);
  }
  console.log('toc rules: ' + tocNumbers.size + '   body rules: ' + headings.length);

  /* ── Assemble each rule ────────────────────────────────────────────────── */
  const rules = new Map();
  const dupes = [];
  for (let k = 0; k < headings.length; k++) {
    const h = headings[k];
    const end = k + 1 < headings.length ? headings[k + 1].i : lines.length;

    let title = h.titleStart;
    let b = h.i + 1;
    while (b < end) {
      const next = lines[b].trim();
      if (!next) {
        if (title) break;   // a blank after a complete title ends it
        b++; continue;      // a bare "Rule 37." can carry its title on a later line
      }
      // A heading can be just the number, with the title following. FRCrP's Rule 37 is printed
      // that way, and the title line is sentence-cased so the usual continuation test rejects it.
      if (!title) { title = next; b++; continue; }
      if (/[A-Za-z]-$/.test(title)) { title = joinLines(title, next); b++; continue; }
      if (looksLikeHeadingContinuation(next)) { title = joinLines(title, next); b++; continue; }
      break;
    }

    const bodyLines = [];
    for (let i = b; i < end; i++) {
      if (isFurniture(lines[i], LABEL)) continue;
      const t = stripInlineFurniture(lines[i], LABEL).trim();
      if (!t) continue;
      // A dot-leader line is a table-of-contents entry, wherever it appears. FRBP prints a SECOND,
      // Part VII contents block mid-document, and because dot-leadered lines are excluded as
      // headings they were not terminating the rule before them either -- so the whole contents
      // block leaked into that rule's body, where its "Rule 7067." tokens then looked like captured
      // headings. The rule is simply that a contents entry is never body text.
      if (/\.{4,}/.test(t)) continue;
      bodyLines.push(t);
    }

    // Preserve subsection structure: a new paragraph starts at a subsection marker or the
    // amendment history. Everything else is a wrapped line and gets rejoined, de-hyphenated.
    const paras = [];
    for (const l of bodyLines) {
      if (/^\([A-Za-z0-9]{1,3}\)\s/.test(l) || /^\((?:As amended|Amended|Pub\. L\.)/i.test(l)) paras.push(l);
      else if (paras.length) {
        const prev = paras[paras.length - 1];
        paras[paras.length - 1] = joinLines(prev, l, isAllCapsSoFar(prev));
      } else paras.push(l);
    }

    let amendments = null;
    const keep = [];
    for (const p of paras) {
      if (/^\((?:As amended|Amended|Pub\. L\.)/i.test(p)) amendments = amendments ? amendments + ' ' + p : p;
      else keep.push(fixMarkerSplit(p));
    }

    const candidate = { num: h.num, title: title.replace(/\s+/g, ' ').trim(), body: keep.join('\n\n'), amendments };

    // A number can appear twice: once as the rule, once as a cross-reference or appendix line that
    // is title-cased and therefore indistinguishable by shape. Overwriting blindly lost the real
    // Rule 107 to an empty later heading. Keep whichever actually carries text, and say so.
    const prev = rules.get(h.num);
    if (prev) {
      dupes.push(h.num + ' (kept: ' + ((candidate.body || '').length > (prev.body || '').length ? 'later' : 'earlier')
        + ', ' + Math.max((candidate.body || '').length, (prev.body || '').length) + ' chars vs '
        + Math.min((candidate.body || '').length, (prev.body || '').length) + ')');
      if ((candidate.body || '').length <= (prev.body || '').length) continue;
    }
    rules.set(h.num, candidate);
  }
  if (dupes.length) console.log('duplicate headings: ' + dupes.join('; '));

  /* ── Assertions ────────────────────────────────────────────────────────── */
  /* ── Small-caps join ───────────────────────────────────────────────────────
     The PDF's typesetter renders some words in small caps, and the text layer can emit them with
     an internal space: "E NFORCE" for ENFORCE. These are shipped defects -- an agent quoting FRBP
     would show the user "P ROPERTY" -- so they are repaired, not merely reported.

     The decision is made against a dictionary built from the corpus's own lower-case words. The
     small-caps styling never touches lower-case text, so that dictionary is independent of the
     defect being measured, and a join is applied only when the joined form is a word this corpus
     uses elsewhere. That is what keeps "A RESPONSIVE PLEADING" (correct) and "COURT'S STATEMENT"
     (correct) out of it while catching "P ROCEEDING" and "E XEMPTIONS". */
  const vocab = new Set();
  for (const r of rules.values()) {
    for (const m of (r.body || '').toLowerCase().matchAll(/[a-z]{3,}/g)) vocab.add(m[0]);
  }
  /**
   * Confirmed separately, by inspection. These are English words the corpus vocabulary cannot
   * confirm because the word appears nowhere else in lower case in that rule set, so the automatic
   * test declines to join them. A lone "O" is not a word, so the split is unambiguous anyway.
   *
   * Listed explicitly rather than inferred, so the decision is auditable. "V OF" is deliberately
   * ABSENT: "V" is a legitimate standalone token (Exhibit V, Rule V), so joining it would corrupt
   * text rather than repair it.
   */
  const CONFIRMED_SPLITS = new Set(['OMISSIONS', 'OBJECTION']);

  let capsFixed = 0;
  const joinSplit = (s) => String(s || '').replace(/(?<![A-Za-z'\u2019])([B-HJ-Z])\s([A-Z]{2,})\b/g,
    (whole, a, b) => {
      const joined = a + b;
      if (!vocab.has(joined.toLowerCase()) && !CONFIRMED_SPLITS.has(joined)) return whole;
      capsFixed++;
      return joined;
    });
  for (const r of rules.values()) {
    r.body = joinSplit(r.body);
    r.title = joinSplit(r.title);
  }

  const problems = [];
  if (!rules.size) problems.push('no rules extracted');
  const missingToc = [...tocNumbers].filter((n) => !rules.has(n));
  if (missingToc.length) problems.push('in the TOC but not extracted: ' + missingToc.join(', '));

  for (const r of rules.values()) {
    if (!r.title) problems.push(r.num + ': no title');
    if (!r.body || r.body.length < 40) {
      // The abrogation note sometimes lands in the title rather than the body, because a bare
      // "Rule 74." heading is followed by the note and nothing else.
      const abrogated = isAbrogationOnly(r.body) || isAbrogationOnly(r.title);
      if (!abrogated) problems.push(r.num + ': body too short (' + (r.body || '').length + ')');
    }
    if (/--\s*\d+\s+of\s+\d+\s*--/.test(r.body)) problems.push(r.num + ': page marker survived');
    if (/\u0393\u00c7|\u252c/.test(r.body + r.title)) problems.push(r.num + ': mojibake survived');
    if (/[<>]/.test(r.body)) problems.push(r.num + ': markup in body');
  }

  // Candidate spacings that MIGHT be small-caps splits. Deliberately narrow: a lone "A" or "I" is
  // an article or pronoun and cannot be evidence of anything ("A RESPONSIVE PLEADING" is correct
  // text). Only a standalone capital that is not a word on its own is worth reporting.
  const capsArtifacts = new Map();
  for (const r of rules.values()) {
    for (const m of (r.body || '').matchAll(/\b[B-HJ-Z]\s[A-Z]{2,}\b/g)) {
      capsArtifacts.set(m[0], (capsArtifacts.get(m[0]) || 0) + 1);
    }
  }

  console.log('\n=== extraction ===');
  console.log('  rules extracted : ' + rules.size);
  console.log('  small-caps fixed: ' + capsFixed);
  console.log('  problems        : ' + problems.length);
  for (const p of problems.slice(0, 20)) console.log('    ' + p);
  if (capsArtifacts.size) {
    console.log('  small-caps splits remaining: '
      + [...capsArtifacts.entries()].map(([k, v]) => JSON.stringify(k) + ' x' + v).join(', '));
  }

  /* ── Write ─────────────────────────────────────────────────────────────── */
  if (rules.size && !problems.length) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const r of rules.values()) {
      // An abrogated rule has no operative text. Its status is structured metadata, NOT text in
      // the body -- otherwise a consumer quoting "what Rule 74 says" would retrieve an editorial
      // note as though it were the rule.
      const abrogated = !(r.body && r.body.length) || isAbrogationOnly(r.body) || isAbrogationOnly(r.title);
      const fm = [
        '---',
        'rule_number: ' + r.num,
        'title: "' + String(r.title).replace(/"/g, '\\"') + '"',
        'status: ' + (abrogated ? 'abrogated' : 'operative'),
        'cite: "' + CITE + '"',
        'edition: "' + EDITION + '"',
        'source: "' + LABEL + ', as amended to December 1, 2024 (Committee on the Judiciary, U.S. House of Representatives; U.S. Government Publishing Office)."',
        'authority: "Public domain (U.S. Government work)."',
      ];
      // Amendment history is structured metadata, NOT body text. It is official text, but it is not
      // the operative rule, and leaving it inside the body would let an agent quoting subdivision
      // (a) read a 2007 amendment note as if it were the rule. The body is therefore the operative
      // text only, and a consumer that wants the history reads this field.
      if (abrogated) fm.push('editorial_note: "Abrogated. No operative text in this edition; the heading is retained in the official print."');
      if (r.amendments) {
        fm.push('amendments: "' + String(r.amendments).replace(/\s+/g, ' ').replace(/"/g, '\\"') + '"');
      }
      fm.push('---');

      /* Two delimiter blocks, unambiguously ordered: frontmatter first, then the body after a
         second separator. A consumer reads `status` before it reaches any text, so an editorial
         note can never be mistaken for rule text. */
      const md = [
        ...fm,
        '',
        '# ' + CITE + ' ' + r.num + ' \u2014 ' + r.title,
        '',
        '**Rule:** ' + r.num + ' \u00b7 **Status:** ' + (abrogated ? 'abrogated' : 'operative'),
        '',
        '---',
        '',
      ];
      if (!abrogated) md.push(r.body);
      // No amendments section here: the history is in frontmatter, so the body is operative text
      // only and a consumer can never quote a 2007 amendment note as if it were the rule.
      fs.writeFileSync(path.join(OUT, r.num + '.md'), md.join('\n') + '\n', 'utf8');
    }
    console.log('\nwrote ' + rules.size + ' files to ' + OUT + ' in ' + (Date.now() - t0) + 'ms');
    fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify({
      label: LABEL, cite: CITE, edition: EDITION, source: path.basename(PDF),
      extracted_at: new Date().toISOString(),
      count: rules.size,
      rules: [...rules.keys()],
    }, null, 2), 'utf8');
  } else if (problems.length) {
    console.log('\nNOT WRITTEN: assertions failed, so no corpus was produced.');
    process.exit(1);
  }
})();
