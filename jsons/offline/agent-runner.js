/**
 * agent-runner.js — the discipline-agnostic agent. One instance per discipline.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Everything that makes a discipline agent work lives in its data folder; this class is the
 * machine that reads that folder and turns a message into a response. Eight agents differ only
 * in their JSON, so the runner must not know anything about Wills, Torts or Evidence.
 *
 * This was extracted from index.js when the second agent landed. The extraction was done
 * carefully enough that the Wills agent's 40 existing assertions pass with **no behavioural
 * change and no test edits** -- that regression, not the new code, is the evidence the
 * generalization is real.
 *
 * THE INVARIANT, RESTATED BECAUSE IT IS EASY TO BREAK
 * --------------------------------------------------
 * No text is ever generated. Every string a response contains is one of exactly three things:
 *
 *   1. corpus text, read verbatim from a bundled file (corpus.js handles the read and the
 *      integrity guard),
 *   2. a hand-authored string from this agent's JSON, filled with those verbatim values, or
 *   3. a pattern-matched reflection that answers nothing and keeps the student talking.
 *
 * Nothing here interpolates, paraphrases or completes legal content. A discipline agent that
 * cannot answer from those three sources reflects or says it is unavailable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Fallback if shared/authority.json is missing, so a citation never renders without saying whether
 * its text was ever checked against the live source.
 */
const AUTHORITY_FALLBACK = {
  verified: 'Verified against flsenate.gov on {date}.',
  unverified: 'From bundled corpus (2026 snapshot) \u2014 not verified against live source.',
};

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** Merge every doctrine-map*.json in an agent folder, so curation can grow by file. */
function loadDoctrines(agentDir) {
  const merged = {};
  let files = [];
  try { files = fs.readdirSync(agentDir); } catch { return merged; }
  for (const f of files) {
    if (!/^doctrine-map.*\.json$/.test(f)) continue;
    const parsed = readJson(path.join(agentDir, f), {});
    Object.assign(merged, parsed.doctrines || {});
  }
  return merged;
}

/** A stable per-input index, so the same question always gets the same reflection. */
function stablePick(list, seed) {
  if (!list || !list.length) return null;
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return list[h % list.length];
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

/** How confident a shape match is. More patterns matching the same type scores higher. */
function confidenceFor(matches) {
  if (!matches) return 0;
  return Math.min(0.95, 0.6 + 0.1 * matches);
}

class OfflineAgent {
  /**
   * @param {string} id         discipline id, e.g. 'torts'
   * @param {object} route      the agent's entry from router.json
   * @param {string} dataRoot   jsons/data/offline
   */
  constructor(id, route, dataRoot) {
    const dir = path.join(dataRoot, route.path);
    this.id = id;
    this.label = route.title;
    this.dir = dir;
    this.chapters = route.chapter_scope || [];
    this.strongSignals = route.strong_signals || [];
    this.vocab = readJson(path.join(dir, 'vocab.json'), {});
    this.shapes = readJson(path.join(dir, 'question-shapes.json'), { types: [] });
    this.templates = readJson(path.join(dir, 'templates.json'), {});
    this.rhythms = readJson(path.join(dir, 'rhythms.json'), {});
    this.glossRules = readJson(path.join(dir, 'gloss-rules.json'), { glosses: {} });
    this.doctrines = loadDoctrines(dir);
  }

  /* ── Classification ────────────────────────────────────────────────────── */

  /** The question type, by the agent's own grammar. 'unknown' is a real answer. */
  questionType(text) {
    const t = String(text || '');
    let best = null;
    for (const shape of this.shapes.types || []) {
      let matches = 0;
      for (const p of shape.patterns || []) {
        try { if (new RegExp(p, 'i').test(t)) matches++; } catch { /* bad pattern: skip */ }
      }
      if (matches > 0 && (!best || matches > best.matches)) best = { type: shape.type, matches };
    }
    return best ? best.type : 'unknown';
  }

  /**
   * Doctrine match by keyword weight, longest keyword first so "elective share" beats "share".
   * Returns null below the threshold -- and null is a real answer here, not a failure.
   */
  doctrineFor(text) {
    const hay = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null;
    for (const [id, d] of Object.entries(this.doctrines)) {
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

  /**
   * True when the message carries a token this discipline explicitly refuses.
   *
   * This is the one capability a single generalist ELIZA cannot have. A generalist has to be
   * fuzzy to fire at all, so every pattern competes with every other; a specialist can afford
   * to say "that is not mine" because it knows exactly which tokens are not.
   */
  isOutOfScope(text) {
    const hay = String(text || '').toLowerCase();
    for (const n of this.vocab.negative || []) {
      if (tokenHit(hay, n)) return n;
    }
    return false;
  }

  /**
   * Returns { type, doctrine, confidence, outOfScope }.
   * `doctrine` is the matched doctrine id, or null.
   */
  classify(text) {
    const type = this.questionType(text);
    const d = this.doctrineFor(text);
    const shapes = this.shapes.types || [];
    let matches = 0;
    for (const shape of shapes) {
      if (shape.type !== type) continue;
      for (const p of shape.patterns || []) {
        try { if (new RegExp(p, 'i').test(String(text || ''))) matches++; } catch { /* skip */ }
      }
    }
    return {
      type,
      doctrine: d ? d.id : null,
      doctrineLabel: d ? d.label : null,
      confidence: type === 'unknown' ? 0 : confidenceFor(matches),
      outOfScope: this.isOutOfScope(text),
    };
  }

  /* ── Response builders. Every string below is corpus text or a template fill. ── */

  glossFor(section) {
    return (this.glossRules.glosses || {})[section] || null;
  }

  /**
   * The authority line: was this text checked against the live source, and when?
   *
   * This is deliberately separate from the attribution line, which says which *file* the text came
   * from. A student citing a statute needs to know whether the copy in front of her was ever
   * checked against the source of truth, and the honest answer for the bundled snapshot is "no".
   */
  authorityLine(record, authority) {
    const a = authority || AUTHORITY_FALLBACK;
    const p = (record && record.provenance) || {};
    if (p.origin === 'overlay' && p.verified_at) {
      return String(a.verified).replace('{date}', String(p.verified_at).slice(0, 10));
    }
    return String(a.unverified);
  }

  /** What is wrong with this bundled copy, said plainly. Null when nothing is. */
  integrityNote(record) {
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

  renderRuleLookup(doctrine, records, authority) {
    const primary = records[0];
    const t = this.templates['rule-lookup'];
    const lines = [
      t.header.replace('{section}', primary.section).replace('{catchline}', primary.catchline || ''),
      '',
      primary.body,
    ];
    const gloss = this.glossFor(primary.section);
    if (gloss) lines.push('', t.gloss_prefix + gloss);
    const warn = this.integrityNote(primary);
    if (warn) lines.push('', '\u26a0 ' + warn);
    lines.push('', t.attribution.replace('{source}', primary.source || 'bundled corpus').replace('{file}', primary.file || ''));
    lines.push('', this.authorityLine(primary, authority));
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

  renderDefinition(term, records, authority) {
    const primary = records[0];
    const t = this.templates.definition;
    // The catchline IS the corpus's own one-line definition of the section, which is why it is
    // quoted rather than paraphrased.
    const lines = [t.header.replace('{term}', primary.catchline || term), '', primary.body];
    const gloss = this.glossFor(primary.section);
    if (gloss) lines.push('', this.templates['rule-lookup'].gloss_prefix + gloss);
    const warn = this.integrityNote(primary);
    if (warn) lines.push('', '\u26a0 ' + warn);
    lines.push('', t.cite_prefix + 'Fla. Stat. \u00a7 ' + primary.section + '. '
      + t.attribution.replace('{source}', primary.source || 'bundled corpus'));
    lines.push('', this.authorityLine(primary, authority));
    return {
      type: 'definition',
      text: lines.join('\n'),
      citation: { section: primary.section, catchline: primary.catchline, source: primary.source, file: primary.file },
      integrity: warn ? { ok: false, note: warn, anomalies: primary.integrity.anomalies } : { ok: true },
    };
  }

  renderReflection(shared, text, why) {
    // Shared patterns first (they substitute the matched phrase), then this discipline's own
    // rhythms, which are written in its practitioners' register.
    for (const p of shared.patterns || []) {
      const m = new RegExp(p.match, 'i').exec(String(text || '').trim());
      if (m) {
        return {
          type: 'reflection',
          text: p.response.replace('{{1}}', (m[1] || '').trim()),
          suggestions: shared.suggestions || [],
          reason: why,
        };
      }
    }
    return {
      type: 'reflection',
      text: stablePick(this.rhythms.reflections, String(text || '')) || 'Tell me more about what you are working out.',
      suggestions: shared.suggestions || [],
      reason: why,
    };
  }

  renderClarify(shared, why, courses) {
    return {
      type: 'clarify',
      text: this.templates.clarify.body.replace('{courses}', courses || this.label),
      suggestions: shared.suggestions || [],
      reason: why,
    };
  }

  renderUnavailable(shared, why) {
    return {
      type: 'unavailable',
      text: this.templates.unavailable.body.replace('{suggestions}', (shared.suggestions || []).join(' | ')),
      suggestions: shared.suggestions || [],
      reason: why,
    };
  }

  /**
   * Turn a message into a response. Never throws, never returns null, never invents text.
   *
   * @param {string} text
   * @param {object} ctx  { corpus, shared, knownDefects }
   * @returns {{type:string, text:string, citation?:object, citations?:Array, integrity?:object}}
   */
  respond(text, ctx) {
    const { corpus, shared, knownDefects, authority } = ctx;
    const type = this.questionType(text);
    const doctrine = this.doctrineFor(text);

    // Procedure playback and drill mode are deliberately deferred to the next cycle. Their
    // question shapes exist so the type is recognised and refused honestly rather than
    // mistaken for a rule lookup.
    if (type === 'procedure' || type === 'drill') {
      return this.renderUnavailable(shared, type + ' is not implemented yet');
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
      sections = corpus.rankSections(text, this.doctrines[doctrine.id].statutes).map((r) => r.section);
    } else {
      sections = corpus.searchCatchlines(text, this.chapters, 3).map((h) => h.section);
    }

    const records = sections.map((s) => corpus.readSection(s, knownDefects)).filter((r) => r.found);

    if (type === 'definition') {
      const term = termFrom(text);
      const primary = records[0];
      // A definition must actually be about the term asked for. Without this gate, "what is the
      // mailbox rule?" matched a Wills section on "rules of evidence" and answered with it.
      const head = String(term).toLowerCase().split(/\s+/)[0] || '';
      const matched = !!primary && !!head && (primary.catchline || '').toLowerCase().includes(head);
      if (!matched) {
        return this.renderReflection(shared, text, 'no bundled section defined "' + term + '"');
      }
      const r = this.renderDefinition(term, records, authority);
      r.citations = records.map((x) => ({ section: x.section, catchline: x.catchline }));
      return r;
    }

    if (records.length) {
      const r = this.renderRuleLookup(doctrine, records, authority);
      r.citations = records.map((x) => ({ section: x.section, catchline: x.catchline }));
      return r;
    }

    // Nothing retrieved: reflect rather than guess.
    return this.renderReflection(shared, text, 'no bundled section matched');
  }
}

/** Word-boundary match for single words, substring for phrases. */
function tokenHit(hay, token) {
  const t = String(token).toLowerCase();
  if (/^[a-z0-9]+$/.test(t)) return new RegExp('\\b' + t + '\\b').test(hay);
  return hay.includes(t);
}

module.exports = { OfflineAgent, readJson, loadDoctrines, stablePick, termFrom, tokenHit, confidenceFor };
