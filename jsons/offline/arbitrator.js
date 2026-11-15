/**
 * arbitrator.js — resolves a question that two discipline agents both claim.
 *
 * WHY THIS IS NEEDED AT ALL
 * -------------------------
 * The router fires on strong signals, and real questions cross disciplines: "can the homestead
 * be devised" is Wills (Fla. Stat. § 732.401) *and* Property (Fla. Const. art. X § 4, ch. 222).
 * Choosing wrongly is worse than choosing slowly, because a specialist's whole value is that it
 * only answers for its own domain -- so a wrong dispatcher turns eight strict specialists back
 * into one fuzzy generalist.
 *
 * The rules below are ordered from objective to subjective on purpose. Only the last resort
 * shows the student two answers, because two contradictory-looking answers with no ranking is a
 * worse experience than one answer plus an honest note about the other reading.
 *
 *   1. Did one agent actually retrieve corpus text and the other only reflect? The one holding
 *      the statute wins -- retrieval is evidence, reflection is not.
 *   2. Both retrieved: more grounded sections wins, if the margin is clear.
 *   3. Still close: the question's own type decides. A "what does Florida say" question belongs
 *      to the discipline with statutes behind it, not the one with commentary.
 *   4. Genuinely tied: show both, labelled, with no pretence that one is right.
 */
'use strict';

/**
 * Disciplines whose corpus support is statute-based rather than case-based. On a rule-lookup
 * question these win a tie, because the answer they can give is the answer that was asked for.
 */
const STATUTE_HEAVY = ['wills-trusts', 'contracts', 'civ-pro', 'crim-pro', 'evidence', 'property'];

/** Responses that actually quote the corpus, as opposed to those that decline to. */
const RETRIEVING = new Set(['rule-lookup', 'definition']);

/**
 * How much verbatim corpus a candidate is standing on. This is a measure of evidence, not of
 * length: a reflection can be longer than a statute and still hold nothing.
 */
function evidenceWeight(candidate) {
  const r = candidate.response || {};
  if (!RETRIEVING.has(r.type)) return 0;
  const cites = (r.citations || (r.citation ? [r.citation] : [])).length;
  const integrityPenalty = r.integrity && r.integrity.ok === false ? 1 : 0;
  return cites * 10 - integrityPenalty * 3;
}

/** Prefer a copy we can stand behind when evidence is otherwise equal. */
function integrityRank(candidate) {
  const r = candidate.response || {};
  return r.integrity && r.integrity.ok === false ? 0 : 1;
}

function isStatuteHeavy(id) {
  return STATUTE_HEAVY.includes(id);
}

function labelOf(candidate) {
  return candidate.label || candidate.id;
}

/** Both answers, clearly attributed, with no ranking implied. */
function renderBoth(primary, secondary) {
  const lines = [
    'This question genuinely touches two disciplines, so here is what each of them says. '
      + 'I am not ranking them -- read both against your facts.',
    '',
    '\u2500\u2500 ' + labelOf(primary) + ' \u2500\u2500',
    String((primary.response || {}).text || '').trim(),
    '',
    '\u2500\u2500 ' + labelOf(secondary) + ' \u2500\u2500',
    String((secondary.response || {}).text || '').trim(),
  ];
  return lines.join('\n');
}

/**
 * @param {object} primary    { id, label, response, classify }
 * @param {object} secondary  same shape
 * @param {string} message    the original question, for the type tiebreak
 * @returns {{ type, text, discipline, merged?, resolvedBy, note? }}
 */
function arbitrate(primary, secondary, message, opts = {}) {
  if (!primary) return null;
  if (!secondary) {
    return {
      type: primary.response.type,
      text: primary.response.text,
      discipline: primary.id,
      response: primary.response,
      resolvedBy: 'only one agent fired',
    };
  }

  const pw = evidenceWeight(primary);
  const sw = evidenceWeight(secondary);

  // Rule 1 & 2: retrieval beats reflection, and a clear evidence margin settles it outright.
  if (pw !== sw && Math.abs(pw - sw) >= 2) {
    const win = pw > sw ? primary : secondary;
    const lose = pw > sw ? secondary : primary;
    return {
      type: win.response.type,
      text: win.response.text,
      discipline: win.id,
      response: win.response,
      resolvedBy: 'more corpus evidence',
      note: labelOf(lose) + ' also claimed this question and had less to ground on.',
    };
  }

  // Equal evidence, but one of them knows its copy is bad: trust the other.
  if (integrityRank(primary) !== integrityRank(secondary)) {
    const win = integrityRank(primary) ? primary : secondary;
    return {
      type: win.response.type,
      text: win.response.text,
      discipline: win.id,
      response: win.response,
      resolvedBy: 'the other response knowingly used a defective copy',
    };
  }

  // Two non-answers are not a better answer. When neither discipline could ground its response
  // there is nothing to reconcile, and showing the student a pair of reflections under two
  // headings would dress up "I do not have this" as a considered conclusion. Return the single
  // honest non-answer, preferring whichever agent actually recognised the topic.
  if (pw === 0 && sw === 0) {
    const primaryKnows = !!(primary.classify && primary.classify.doctrine);
    const secondaryKnows = !!(secondary.classify && secondary.classify.doctrine);
    const win = (!primaryKnows && secondaryKnows) ? secondary : primary;
    return {
      type: win.response.type,
      text: win.response.text,
      discipline: win.id,
      response: win.response,
      resolvedBy: 'neither discipline could ground an answer',
    };
  }

  // Rule 3: the question's own shape decides. A rule lookup wants statutes.
  const type = (primary.classify || {}).type || (opts.classifyQuestionType && opts.classifyQuestionType(message));
  if (type === 'rule-lookup') {
    const aHeavy = isStatuteHeavy(primary.id);
    const bHeavy = isStatuteHeavy(secondary.id);
    if (aHeavy !== bHeavy) {
      const win = aHeavy ? primary : secondary;
      return {
        type: win.response.type,
        text: win.response.text,
        discipline: win.id,
        response: win.response,
        resolvedBy: 'statute-backed discipline, on a rule-lookup question',
      };
    }
  }

  // Rule 4: genuinely tied. Show both and say so.
  return {
    type: 'merged',
    text: renderBoth(primary, secondary),
    discipline: primary.id,
    merged: [
      { id: primary.id, label: labelOf(primary), response: primary.response },
      { id: secondary.id, label: labelOf(secondary), response: secondary.response },
    ],
    resolvedBy: 'tie',
    note: 'This question could go either way \u2014 here is what each discipline says.',
  };
}

module.exports = { arbitrate, evidenceWeight, renderBoth, STATUTE_HEAVY, RETRIEVING };
