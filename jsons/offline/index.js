/**
 * index.js — the offline mode entry point.
 *
 * ONE INVARIANT GOVERNS EVERYTHING HERE: no text is ever generated. Every response is either
 * (a) verbatim retrieval from the bundled corpus, (b) a hand-authored string from a JSON file,
 * or (c) a pattern-matched reflection. There is no model call and no interpolation of legal
 * content. If the app cannot answer from those three sources it says so.
 *
 * That is the whole reason offline mode is safe to trust on a rule question: it is not a worse
 * model, it is a different kind of system with a smaller failure surface. It can be *silent* or
 * *incomplete*, but it cannot invent a rule -- which is the failure that put a wrong proposition
 * into the Wills packet.
 */
'use strict';

const path = require('path');
const corpus = require('./corpus');
const router = require('./router');
const arbitrator = require('./arbitrator');
const { OfflineAgent, readJson, termFrom } = require('./agent-runner');

const DATA_ROOT = path.join(__dirname, '..', 'data', 'offline');

/* Loading and per-agent classification now live in agent-runner.js (the OfflineAgent class).
   They were moved there when the second agent landed, so that eight disciplines share one
   implementation instead of eight copies of the same loader. */

let _state = null;
/** Loads the router, known defects, shared patterns and every active agent once. */
function load() {
  if (_state) return _state;
  const knownDefects = (readJson(path.join(DATA_ROOT, 'shared', 'known-defects.json'), {})).sections || {};
  const shared = readJson(path.join(DATA_ROOT, 'shared', 'reflection-patterns.json'), { patterns: [], suggestions: [] });
  const authority = readJson(path.join(DATA_ROOT, 'shared', 'authority.json'), null);
  const rt = router.load(DATA_ROOT);
  const meta = {};
  const agents = {};
  for (const id of rt.active || []) {
    agents[id] = new OfflineAgent(id, rt.agents[id], DATA_ROOT);
    meta[id] = agents[id].vocab;   // the router scores against the agent's own register
  }
  _state = { rt, agents, meta, knownDefects, shared, authority };
  return _state;
}

/* ── Classification ──────────────────────────────────────────────────────── */

/**
 * Backwards-compatible wrappers. Classification moved onto OfflineAgent so that one discipline
 * cannot drift from another; these keep the old call signature working for existing callers.
 */
function questionType(agent, text) { return agent.questionType(text); }
function doctrineFor(agent, text) { return agent.doctrineFor(text); }

/* ── Response builders. Every string below is corpus text or a template fill. ── */

/* Response builders moved to agent-runner.js with the rest of the per-agent logic. */

/**
 * Answer a question with no network and no API key.
 *
 * Always resolves to a response object; never throws, never returns null, and never invents
 * legal text. `text` is always present, so any caller can render it as plain text.
 *
 * With one discipline active this is the old single-agent path. With several, the two
 * highest-scoring disciplines are built and handed to the arbitrator.
 */
function ask(text, _opts = {}) {
  const S = load();
  const routing = router.dispatch(text, S.rt, S.meta);

  // Nothing dispatched. Returning nothing is an honest outcome, so never guess.
  //
  // Which non-answer to give is not arbitrary. If the message matches one of the shared
  // reflection patterns the agent can engage with the term itself ("which statute or doctrine are
  // you working from?"), and that moves the student forward. If nothing matched at all there is
  // nothing to engage with, and a clarify asking which course it is for is the honest answer.
  // Before this distinction existed, one weak token was enough to dispatch a discipline, so the
  // choice between the two was being made by accident rather than by the content of the message.
  if (!routing.agentIds.length) {
    const only = S.agents[Object.keys(S.agents)[0]];
    const matchedShared = (S.shared.patterns || []).some((p) => {
      try { return new RegExp(p.match, 'i').test(String(text || '').trim()); } catch { return false; }
    });
    const courses = Object.keys(S.agents).map((k) => S.agents[k].label).join(' / ');
    return {
      ok: true, source: 'offline', agent: only.id,
      ...(matchedShared
        ? only.renderReflection(S.shared, text, routing.reason)
        : only.renderClarify(S.shared, routing.reason, courses)),
    };
  }

  const ctx = { corpus, shared: S.shared, knownDefects: S.knownDefects, authority: S.authority };

  // The arbitrator exists to resolve a genuine collision, not to second-guess the router.
  //
  // This distinction matters more than it looks. A discipline that out-scores the next one by a
  // whole strong signal (3 points) owns the question; letting the runner-up substitute its own
  // answer "because the winner's bundled copy was less clean" is how "what are the elements of a
  // valid will" got answered by Torts with § 769.06, Contracts limiting liability invalid. So
  // only a close call -- a margin under one strong signal -- is put to the arbitrator.
  const ranked = routing.ranked;
  const contested = ranked.length > 1 && (ranked[0].score - ranked[1].score) < 3;
  const contenderIds = (contested ? ranked.slice(0, 2) : ranked.slice(0, 1)).map((r) => r.id);
  const courses = Object.keys(S.agents).map((k) => S.agents[k].label).join(' / ');

  // An agent whose negative list refuses the question is dropped before it can win, which is the
  // whole point of a discipline owning a negative list: "what are the elements of consideration"
  // must not be answered by Wills.
  const candidates = [];
  const refusals = [];
  for (const id of contenderIds) {
    const agent = S.agents[id];
    if (!agent) continue;
    const refusal = agent.isOutOfScope(text);
    if (refusal) { refusals.push({ id, token: refusal }); continue; }
    candidates.push({
      id, label: agent.label, agent,
      classify: agent.classify(text),
      response: agent.respond(text, ctx),
    });
  }

  if (!candidates.length) {
    const agent = S.agents[ranked[0].id];
    return {
      ok: true, source: 'offline', agent: agent.id,
      ...agent.renderClarify(S.shared,
        'the discipline that matched refuses this topic (' + refusals.map((f) => f.token).join(', ') + ')',
        courses),
    };
  }

  const verdict = contested
    ? arbitrator.arbitrate(candidates[0], candidates[1] || null, text)
    : arbitrator.arbitrate(candidates[0], null, text);
  // A merged verdict carries its own text rather than a single response object, so it must be
  // spread explicitly. Spreading `verdict.response` here left `text` undefined for merged
  // answers, which meant a renderer had nothing to show.
  const out = verdict.merged
    ? {
        ok: true, source: 'offline', agent: verdict.discipline,
        type: verdict.type, text: verdict.text,
        merged: verdict.merged, note: verdict.note,
      }
    : { ok: true, source: 'offline', agent: verdict.discipline, ...verdict.response };
  if (verdict.resolvedBy && verdict.resolvedBy !== 'only one agent fired') {
    out.arbitration = { resolvedBy: verdict.resolvedBy };
    if (verdict.note) out.arbitration.note = verdict.note;
  }
  // Say who else claimed it, so an ambiguous question does not silently look settled.
  if (!contested && ranked[1] && S.agents[ranked[1].id]) {
    out.note = out.note || (S.agents[ranked[1].id].label
      + ' also claimed this question; the route was not close enough to split it.');
  }
  return out;
}

module.exports = { load, ask, questionType, doctrineFor, termFrom, DATA_ROOT };
