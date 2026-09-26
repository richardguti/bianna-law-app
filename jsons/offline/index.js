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

const fs = require('fs');
const path = require('path');
const corpus = require('./corpus');
const router = require('./router');

const DATA_ROOT = path.join(__dirname, '..', 'data', 'offline');

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** Merge every doctrine-map*.json in an agent folder, so curation can grow by file. */
function loadDoctrines(agentDir) {
  const merged = {};
  for (const f of fs.readdirSync(agentDir)) {
    if (!/^doctrine-map.*\.json$/.test(f)) continue;
    const parsed = readJson(path.join(agentDir, f), {});
    Object.assign(merged, parsed.doctrines || {});
  }
  return merged;
}

function loadAgent(id, route) {
  const dir = path.join(DATA_ROOT, route.path);
  return {
    id,
    label: route.title,
    chapters: route.chapter_scope || [],
    strongSignals: route.strong_signals || [],
    vocab: readJson(path.join(dir, 'vocab.json'), {}),
    shapes: readJson(path.join(dir, 'question-shapes.json'), { types: [] }),
    templates: readJson(path.join(dir, 'templates.json'), {}),
    rhythms: readJson(path.join(dir, 'rhythms.json'), {}),
    glossRules: readJson(path.join(dir, 'gloss-rules.json'), { glosses: {} }),
    doctrines: loadDoctrines(dir),
  };
}

let _state = null;
/** Loads the router, known defects, shared patterns and every active agent once. */
function load() {
  if (_state) return _state;
  const knownDefects = (readJson(path.join(DATA_ROOT, 'shared', 'known-defects.json'), {})).sections || {};
  const shared = readJson(path.join(DATA_ROOT, 'shared', 'reflection-patterns.json'), { patterns: [], suggestions: [] });
  const rt = router.load(DATA_ROOT);
  const meta = {};
  const agents = {};
  for (const id of rt.active || []) {
    agents[id] = loadAgent(id, rt.agents[id]);
    meta[id] = agents[id].vocab;   // the router scores against the agent's own register
  }
  _state = { rt, agents, meta, knownDefects, shared };
  return _state;
}

/* ── Classification ──────────────────────────────────────────────────────── */

function questionType(agent, text) {
  const t = String(text || '');
  for (const shape of agent.shapes.types || []) {
    for (const p of shape.patterns || []) {
      if (new RegExp(p, 'i').test(t)) return shape.type;
    }
  }
  return 'unknown';
}

/**
 * Doctrine match by keyword weight, longest keyword first so "elective share" beats "share".
 * Returns null below the threshold -- and null is a real answer here, not a failure.
 */
function doctrineFor(agent, text) {
  const hay = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null;
  for (const [id, d] of Object.entries(agent.doctrines)) {
    let score = 0;
    for (const kw of d.keywords || []) {
      const k = kw.toLowerCase();
      if (k.includes(' ')) { if (hay.includes(' ' + k + ' ') || hay.includes(k)) score += 4; }
      else if (new RegExp('\\b' + k + '\\b').test(hay)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) best = { id, score, label: d.label };
  }
  return best && best.score >= 2 ? best : null;
}

/** A stable per-input index, so the same question always gets the same reflection. */
function stablePick(list, seed) {
  if (!list || !list.length) return null;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/* ── Response builders. Every string below is corpus text or a template fill. ── */

function glossFor(agent, section) {
  return (agent.glossRules.glosses || {})[section] || null;
}

/** What is wrong with this bundled copy, said plainly. Null when nothing is. */
function integrityNote(record) {
  if (!record.integrity) return null;
  if (record.integrity.knownDefect) {
    return 'This is a known bad copy in the bundle: ' + record.integrity.knownDefect.detail;
  }
  if (record.integrity.anomalies.includes('tail_contaminated')) {
    return 'Heads up: the bundled copy of \u00a7 ' + record.section + ' has another section\u2019s text '
         + 'spliced onto its tail, and may also be missing subsections. The text above is what the '
         + 'bundle has; read flsenate.gov/Statutes for the full section.';
  }
  if (record.integrity.anomalies.length) {
    return 'Heads up: the bundled copy of \u00a7 ' + record.section + ' looks imperfect ('
         + record.integrity.anomalies.join(', ') + '). Verify against flsenate.gov/Statutes.';
  }
  return null;
}

function renderRuleLookup(agent, doctrine, records) {
  const primary = records[0];
  const t = agent.templates['rule-lookup'];
  const lines = [
    t.header.replace('{section}', primary.section).replace('{catchline}', primary.catchline || ''),
    '',
    primary.body,
  ];
  const gloss = glossFor(agent, primary.section);
  if (gloss) lines.push('', t.gloss_prefix + gloss);
  const warn = integrityNote(primary);
  if (warn) lines.push('', '\u26a0 ' + warn);
  lines.push('', t.attribution.replace('{source}', primary.source || 'bundled corpus').replace('{file}', primary.file || ''));
  if (records.length > 1) {
    lines.push(t.related.replace('{related}',
      records.slice(1).map((r) => '\u00a7 ' + r.section + ' (' + (r.catchline || '') + ')').join('; ')));
  }
  return {
    type: 'rule-lookup',
    text: lines.join('\n'),
    citation: { section: primary.section, catchline: primary.catchline, source: primary.source, file: primary.file },
    alsoFound: records.slice(1).map((r) => ({ section: r.section, catchline: r.catchline })),
    integrity: warn ? { ok: false, note: warn, anomalies: primary.integrity.anomalies } : { ok: true },
    doctrine: doctrine ? { id: doctrine.id, label: doctrine.label } : null,
  };
}

/** Strip the lead-in so "what is ademption?" and "define ademption" both yield "ademption". */
function termFrom(text) {
  return String(text || '')
    .replace(/^\s*(?:what\s+(?:is|are)|define|what\s+does|explain|tell\s+me\s+about)\s+/i, '')
    .replace(/\s+mean\s*\??\s*$/i, '')
    .replace(/[?.!]+\s*$/, '')
    .replace(/^\s*(?:an?|the)\s+/i, '')
    .trim();
}

function renderDefinition(agent, term, records) {
  const primary = records[0];
  const t = agent.templates.definition;
  // The catchline IS the corpus's own one-line definition of the section, which is why it is
  // quoted rather than paraphrased.
  const lines = [t.header.replace('{term}', primary.catchline || term), '', primary.body];
  const gloss = glossFor(agent, primary.section);
  if (gloss) lines.push('', agent.templates['rule-lookup'].gloss_prefix + gloss);
  const warn = integrityNote(primary);
  if (warn) lines.push('', '\u26a0 ' + warn);
  lines.push('', t.cite_prefix + 'Fla. Stat. \u00a7 ' + primary.section + '. '
    + t.attribution.replace('{source}', primary.source || 'bundled corpus'));
  return {
    type: 'definition',
    text: lines.join('\n'),
    citation: { section: primary.section, catchline: primary.catchline, source: primary.source, file: primary.file },
    integrity: warn ? { ok: false, note: warn, anomalies: primary.integrity.anomalies } : { ok: true },
  };
}

function renderReflection(S, agent, text, why) {
  // Shared patterns first (they substitute the matched phrase), then this discipline's own
  // rhythms, which are written in its practitioners' register.
  for (const p of S.shared.patterns || []) {
    const m = new RegExp(p.match, 'i').exec(String(text || '').trim());
    if (m) {
      return {
        type: 'reflection',
        text: p.response.replace('{{1}}', (m[1] || '').trim()),
        suggestions: S.shared.suggestions || [],
        reason: why,
      };
    }
  }
  return {
    type: 'reflection',
    text: stablePick(agent.rhythms.reflections, String(text || '')) || 'Tell me more about what you are working out.',
    suggestions: S.shared.suggestions || [],
    reason: why,
  };
}

function renderClarify(S, agent, why) {
  return {
    type: 'clarify',
    text: agent.templates.clarify.body.replace('{courses}', agent.label),
    suggestions: S.shared.suggestions || [],
    reason: why,
  };
}

function renderUnavailable(S, agent, why) {
  return {
    type: 'unavailable',
    text: agent.templates.unavailable.body.replace('{suggestions}', (S.shared.suggestions || []).join(' | ')),
    suggestions: S.shared.suggestions || [],
    reason: why,
  };
}

/**
 * Answer a question with no network and no API key.
 *
 * Always resolves to a response object; never throws, never returns null, and never invents
 * legal text. `text` is always present, so any caller can render it as plain text.
 */
function ask(text, _opts = {}) {
  const S = load();
  const routing = router.dispatch(text, S.rt, S.meta);
  if (!routing.agentIds.length) {
    const only = S.agents[Object.keys(S.agents)[0]];
    return { ok: true, source: 'offline', agent: only.id, ...renderClarify(S, only, routing.reason) };
  }
  const agent = S.agents[routing.agentIds[0]];
  const type = questionType(agent, text);
  const doctrine = doctrineFor(agent, text);

  // Procedure playback and drill mode are deliberately deferred to the next cycle.
  if (type === 'procedure' || type === 'drill') {
    return { ok: true, source: 'offline', agent: agent.id, ...renderUnavailable(S, agent, type + ' is not implemented yet') };
  }

  const cite = corpus.normalizeSection(text);
  let sections;
  if (cite) {
    // An explicit citation pins retrieval to exactly that section -- the student naming a
    // section is the strongest signal there is.
    sections = [cite];
  } else if (doctrine) {
    // Rank the doctrine's own sections against the question. Taking them in list order made
    // "define ademption" return the doctrine's first section instead of the ademption one.
    sections = corpus.rankSections(text, agent.doctrines[doctrine.id].statutes).map((r) => r.section);
  } else {
    sections = corpus.searchCatchlines(text, agent.chapters, 3).map((h) => h.section);
  }

  const records = sections.map((s) => corpus.readSection(s, S.knownDefects)).filter((r) => r.found);

  if (type === 'definition') {
    const term = termFrom(text);
    const primary = records[0];
    // A definition must actually be about the term asked for. Without this gate, "what is the
    // mailbox rule?" matched a Wills section on "rules of evidence" and answered with it.
    const head = String(term).toLowerCase().split(/\s+/)[0] || '';
    const matched = !!primary && !!head && (primary.catchline || '').toLowerCase().includes(head);
    if (!matched) {
      return { ok: true, source: 'offline', agent: agent.id, ...renderReflection(S, agent, text, 'no bundled section defined "' + term + '"') };
    }
    return { ok: true, source: 'offline', agent: agent.id, ...renderDefinition(agent, term, records) };
  }

  if (records.length) {
    return { ok: true, source: 'offline', agent: agent.id, ...renderRuleLookup(agent, doctrine, records) };
  }

  // Nothing retrieved: reflect rather than guess.
  return { ok: true, source: 'offline', agent: agent.id, ...renderReflection(S, agent, text, 'no bundled section matched') };
}

module.exports = { load, ask, questionType, doctrineFor, termFrom, DATA_ROOT };
