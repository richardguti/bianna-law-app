/**
 * router.js — decides which discipline agent owns a message.
 *
 * Design notes that matter for correctness:
 *
 *  - Strong signals only. Generic legal words ("rule", "elements", "test") are shared by every
 *    discipline, so they never dispatch on their own. Otherwise "what are the elements of
 *    consideration" would land on the Wills agent and get a confident wrong answer.
 *
 *  - The negative list subtracts. A discipline's "not mine" tokens matter as much as its "mine"
 *    tokens, and this is the piece a single generalist ELIZA cannot have at all.
 *
 *  - No match means reflection, never a guess. Returning nothing is a valid, honest outcome.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function load(dataRoot) {
  const p = path.join(dataRoot, 'router.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Weights: an explicit citation is the strongest possible signal, then doctrine vocabulary. */
const W = { citation: 5, strong: 3, medium: 2, weak: 1, negative: -5 };

function scoreAgent(text, agent) {
  const hay = String(text || '').toLowerCase();
  const hits = [];

  const citation = (hay.match(/\b\d{3}\.\d{3,}\b/g) || []);
  const inScope = citation.filter((c) => (agent.chapter_scope || []).some((ch) => c.startsWith(ch + '.')));
  let score = inScope.length * W.citation;
  if (inScope.length) hits.push('citation:' + inScope.join(','));

  for (const s of agent.strong_signals || []) {
    if (tokenHit(hay, s)) { score += W.strong; hits.push('strong:' + s); }
  }
  const roster = agent.__vocab;
  if (roster) {
    for (const s of roster.medium || []) if (tokenHit(hay, s)) { score += W.medium; hits.push('medium:' + s); }
    for (const s of roster.weak || []) if (tokenHit(hay, s)) { score += W.weak; hits.push('weak:' + s); }
    for (const s of roster.negative || []) if (tokenHit(hay, s)) { score += W.negative; hits.push('negative:' + s); }
  }
  return { score, hits };
}

/** Word-boundary match for single words, substring for phrases. */
function tokenHit(hay, token) {
  const t = String(token).toLowerCase();
  if (/^[a-z0-9]+$/.test(t)) return new RegExp('\\b' + t + '\\b').test(hay);
  return hay.includes(t);
}

/**
 * Returns { agentIds, scores, reason }. agentIds is empty when nothing dispatched, which the
 * caller turns into a reflection rather than an answer.
 */
function dispatch(text, router, agentMeta = {}) {
  const ids = router.active || [];
  const scores = [];
  for (const id of ids) {
    const agent = { ...router.agents[id], __vocab: agentMeta[id] };
    if (!agent) continue;
    const { score, hits } = scoreAgent(text, agent);
    scores.push({ id, score, hits });
  }
  scores.sort((a, b) => b.score - a.score);

  const winners = scores.filter((s) => s.score > 0);
  if (!winners.length) return { agentIds: [], scores, reason: 'no discipline dispatched' };

  // With one agent active this is trivially the winner; the shape is here so a second agent
  // plugs in without changing this function. The arbitrator (deferred) will resolve ties.
  const top = winners[0].score;
  const tied = winners.filter((s) => s.score === top);
  return {
    agentIds: tied.map((t) => t.id),
    scores,
    reason: tied.length > 1 ? 'tie between ' + tied.map((t) => t.id).join(' and ') : 'top score',
  };
}

module.exports = { load, dispatch, scoreAgent, tokenHit };
