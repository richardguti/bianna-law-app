/**
 * rag.js — Local keyword retrieval across the app's legal corpora.
 *
 * Two corpora, one shape. `legal-data.json` is the hand-written seed set (rules, FRCP);
 * `doctrines.json` is generated from the local doctrine library by
 * `tools/build_doctrine_corpus.js`. Keeping them in separate files means the generated one can
 * be rebuilt or deleted without touching anything curated.
 *
 * Architecture: keyword overlap scoring over a JSON chunk store. No external APIs, no native
 * binaries, fully offline. A vector index is a drop-in upgrade at the `retrieve()` boundary —
 * nothing above it knows how the ranking was produced.
 *
 * Two changes from the first version, both forced by the corpus growing from 21 chunks to
 * thousands:
 *
 *   1. MATCHING IS NO LONGER A REGEX PER CHUNK. The old loop constructed a fresh RegExp inside
 *      the chunk loop, so the cost was chunks × tokens compilations per query. At 21 chunks that
 *      was invisible; at several thousand it is the whole query.
 *
 *   2. The lower-cased haystack is computed once at load and cached on the chunk, so scoring
 *      only counts.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { classifyDomain } = require('./domain-classifier');

const DATA_DIR = path.join(__dirname, 'legal-data');

/** Corpora, in the order results should be preferred when scores tie. */
const CORPUS_FILES = ['legal-data.json', 'doctrines.json'];

// Common English stop-words to exclude from scoring
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'shall','that','this','these','those','it','its','not','no','nor',
  'if','as','so','then','than','when','where','which','who','whom',
  'what','how','any','all','each','both','more','most','very','also',
  'their','they','them','there','here','his','her','our','your','we',
  'he','she','you','i','my','me','us','up','out','can','just','about',
]);

let _state = null;

/**
 * Load every corpus once. A missing or malformed file is logged and skipped: one bad generated
 * file must not take the curated corpus down with it.
 */
function load() {
  if (_state) return _state;

  const chunks = [];
  const corpora = [];

  for (const fileName of CORPUS_FILES) {
    const full = path.join(DATA_DIR, fileName);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      const list = Array.isArray(parsed.chunks) ? parsed.chunks : [];

      for (const chunk of list) {
        if (!chunk || typeof chunk.content !== 'string') continue;
        // Domain is stamped at build time; the curated seed file predates the stamp, so it is
        // classified here with the same rules rather than being left unfileable.
        const domain =
          chunk.domain ||
          classifyDomain(
            `${chunk.source || ''} ${chunk.title || ''} ${chunk.content.slice(0, 600)}`,
          ).domain;
        chunks.push({
          id: chunk.id,
          source: chunk.source || fileName,
          title: chunk.title || '',
          content: chunk.content,
          domain,
          // Cached so scoring never re-lowercases or re-tokenises a chunk.
          _lc: `${chunk.title || ''} ${chunk.source || ''} ${chunk.content}`.toLowerCase(),
          _titleLc: String(chunk.title || '').toLowerCase(),
          _len: 0,
        });
      }

      corpora.push({
        file: fileName,
        chunks: list.length,
        version: parsed.version || null,
        generatedAt: parsed.generatedAt || null,
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[RAG] ${fileName} unreadable:`, error.message);
      }
    }
  }

  // Length statistics, computed once. BM25 needs each chunk's length and the corpus average;
  // deriving them per query would cost more than the ranking itself.
  let totalLength = 0;
  for (const chunk of chunks) {
    chunk._len = chunk._lc.split(/\s+/).length;
    totalLength += chunk._len;
  }
  const avgLength = chunks.length ? totalLength / chunks.length : 0;

  _state = { chunks, corpora, avgLength };
  return _state;
}

/** Tokenize text into meaningful keywords (lowercase, no stop-words, length ≥ 3). */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Score one chunk with BM25.
 *
 * Two corrections to a plain keyword count, both of which the corpus forced:
 *
 *   - TERM FREQUENCY SATURATES. A chunk that says "evidence" six times is not six times more
 *     relevant than one that says it twice, and a dense statute volume repeats every word.
 *     The `(tf * (k1 + 1)) / (tf + ...)` term bends the curve over.
 *   - LENGTH IS NORMALISED. Longer chunks contain more of everything, so an unnormalised count
 *     ranks whatever is longest. `b` pulls that back toward the corpus average.
 *
 * Title hits are a flat bonus rather than a multiplier: a term in the title is a strong signal,
 * but it should not scale with how often the term appears in a 1,400-character body.
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_BONUS = 2;

function scoreChunk(chunk, tokens, idf, avgLength) {
  let score = 0;
  let matched = 0;
  const lengthNorm = avgLength > 0 ? chunk._len / avgLength : 1;

  for (const token of tokens) {
    const tf = countOccurrences(chunk._lc, token);
    if (!tf) continue;
    matched += 1;

    const weight = idf.get(token) || 1;
    const saturation =
      (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * lengthNorm));

    const inTitle = countOccurrences(chunk._titleLc, token);
    score += weight * (saturation + inTitle * TITLE_BONUS);
  }

  /**
   * Coverage.
   *
   * BM25 answers "how strongly does this chunk contain the query's words", which is not the
   * question. A chunk that repeats one rare term outscores one containing every term once — and
   * over a corpus that is mostly statute, that is how a question about evidence doctrine returns a
   * tax regulation. Applied linearly: a chunk matching half the query still scores, it just no
   * longer wins. An earlier, squared version was too sharp and returned nothing at all.
   */
  const coverage = tokens.length ? matched / tokens.length : 0;
  return score * coverage;
}

/**
 * Rank chunks for a query.
 *
 * `domain` is a hard filter, not a boost. An attorney bound to property must not be able to reach
 * a contracts chunk because it happened to score well — the whole point of a dedicated profile is
 * that its knowledge is its own, and a reranking preference would let cross-domain material back in
 * exactly when the evidence is thin.
 *
 * `maxPerSource` keeps a single publisher from filling the top-K: the corpus is unbalanced by
 * construction, and without the cap a question about a doctrine returns four sections of one code.
 *
 * @returns {Array<{id, source, title, content, domain, score}>} strongest first
 */
function retrieve(query, topK = 3, minScore = 1, maxPerSource = 2, domain = null) {
  const { chunks, avgLength } = load();
  if (!chunks.length) return [];

  const pool = domain ? chunks.filter((chunk) => chunk.domain === domain) : chunks;
  if (!pool.length) return [];

  const tokens = tokenize(query);
  if (!tokens.length) return [];

  // Document frequency for the query's tokens only — no corpus-wide index to maintain, and the
  // scan is one `includes` per chunk per token. Computed over the pool, so a domain's own
  // vocabulary sets its weights rather than the whole shelf's.
  const df = new Map(tokens.map((token) => [token, 0]));
  for (const chunk of pool) {
    for (const token of tokens) {
      if (chunk._lc.includes(token)) df.set(token, df.get(token) + 1);
    }
  }
  const idf = new Map(
    [...df.entries()].map(([token, count]) => [
      token,
      count === 0 ? 0 : Math.log(1 + pool.length / count),
    ]),
  );

  const scored = [];
  for (const chunk of pool) {
    const score = scoreChunk(chunk, tokens, idf, avgLength);
    if (score >= minScore) scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  const perSource = new Map();

  // First pass honours the cap; the second fills any remainder, so a query that genuinely only
  // matches one source still returns a useful number of results rather than silently fewer.
  for (const item of scored) {
    if (picked.length >= topK) break;
    const source = item.chunk.source;
    const used = perSource.get(source) || 0;
    if (used >= maxPerSource) continue;
    perSource.set(source, used + 1);
    picked.push(item);
  }

  for (const item of scored) {
    if (picked.length >= topK) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked.slice(0, topK).map(({ chunk, score }) => ({
    id: chunk.id,
    source: chunk.source,
    title: chunk.title,
    content: chunk.content,
    domain: chunk.domain,
    score,
  }));
}

/**
 * Retrieval that always returns its best attempt, and says how hard it had to try.
 *
 * A search box that answers "no results" is usually lying: the corpus holds something adjacent to
 * almost any legal query, and an empty panel reads as "the library is missing this" when the truth
 * is "none of your exact words appear". So this degrades in three stages instead of failing —
 *
 *   1. STRICT. The query as typed, scored normally.
 *   2. LOOSENED. Tokens that appear in no chunk at all are dropped (a typo or a case name the
 *      corpus lacks should not sink the whole query), and the score floor is lowered.
 *   3. PARTIAL. Rank by whatever fraction of the query matched, with no floor at all.
 *
 * `relaxed` carries which stage answered, so the interface can say "closest available" rather
 * than presenting a weak match as though it were exact.
 */
function retrieveAdaptive(query, topK = 5, domain = null) {
  const strict = retrieve(query, topK, 1, 2, domain);
  if (strict.length) return { hits: strict, relaxed: false, note: null };

  const { chunks } = load();
  const pool = domain ? chunks.filter((chunk) => chunk.domain === domain) : chunks;
  if (!pool.length) {
    return { hits: [], relaxed: false, note: 'This practice area has no indexed material yet.' };
  }

  const tokens = tokenize(query);
  const present = tokens.filter((token) => pool.some((chunk) => chunk._lc.includes(token)));

  if (present.length && present.length < tokens.length) {
    const loosened = retrieve(present.join(' '), topK, 0.05, 2, domain);
    if (loosened.length) {
      const dropped = tokens.filter((token) => !present.includes(token));
      return {
        hits: loosened,
        relaxed: true,
        note: `No passage contains ${dropped.map((t) => `“${t}”`).join(', ')}; showing the closest matches on the rest.`,
      };
    }
  }

  // Nothing in the query matches anything. Fall back to the pool's densest material rather than
  // an empty panel, clearly labelled — the reader can then search again with better terms.
  const partial = [];
  for (const chunk of pool) {
    let matched = 0;
    for (const token of tokens) if (chunk._lc.includes(token)) matched += 1;
    if (matched > 0) partial.push({ chunk, score: matched });
  }
  partial.sort((a, b) => b.score - a.score);

  if (partial.length) {
    return {
      hits: partial.slice(0, topK).map(({ chunk, score }) => ({
        id: chunk.id,
        source: chunk.source,
        title: chunk.title,
        content: chunk.content,
        domain: chunk.domain,
        score,
      })),
      relaxed: true,
      note: 'Only part of the query appears in this material; these are the closest passages.',
    };
  }

  /**
   * Nothing matched at all — not even one token. Returning an empty list here is technically
   * correct and practically useless: the panel goes blank and the reader has to guess whether the
   * library is missing the subject or the words were wrong. Instead, show a spread of this area's
   * own material, taken deterministically across the pool so it is stable between queries, and say
   * plainly that it is a starting point rather than a match.
   */
  const spread = []
  const step = Math.max(1, Math.floor(pool.length / Math.max(1, topK)))
  for (let i = 0; i < pool.length && spread.length < topK; i += step) {
    spread.push(pool[i])
  }

  return {
    hits: spread.map((chunk) => ({
      id: chunk.id,
      source: chunk.source,
      title: chunk.title,
      content: chunk.content,
      domain: chunk.domain,
      score: 0,
    })),
    relaxed: true,
    note: 'No passage contains those words. These are representative passages from this practice area — start from one of them or search a doctrine, section, or case name.',
  };
}

/**
 * Retrieve the top-K chunks and format them as a context block for the system prompt.
 *
 * Unchanged contract: `[source] title\ncontent` separated by rules, so the prompt-side
 * grounding block keeps its shape.
 */
function getRelevantContext(query, topK = 3, minScore = 1) {
  const hits = retrieve(query, topK, minScore);
  if (!hits.length) return '';
  return hits
    .map(({ source, title, content }) => `[${source}] ${title}\n${content}`)
    .join('\n\n---\n\n');
}

/**
 * Titles for the UI. Capped, because the doctrines corpus alone is thousands of chunks and a
 * full list across IPC would stall the renderer for a panel that only ever shows a sample.
 */
function listSources(limit = 500) {
  const { chunks } = load();
  return chunks.slice(0, limit).map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    title: chunk.title,
  }));
}

/** Counts and generation metadata for the knowledge-base panel, broken down by domain. */
function corpusStats() {
  const { chunks, corpora } = load();
  const sources = new Map();
  const domains = {};
  const domainSources = {};

  for (const chunk of chunks) {
    sources.set(chunk.source, (sources.get(chunk.source) || 0) + 1);
    domains[chunk.domain] = (domains[chunk.domain] || 0) + 1;
    if (!domainSources[chunk.domain]) domainSources[chunk.domain] = new Set();
    domainSources[chunk.domain].add(chunk.source);
  }

  return {
    chunkCount: chunks.length,
    sourceCount: sources.size,
    corpora,
    domains,
    domainSourceCounts: Object.fromEntries(
      Object.entries(domainSources).map(([domain, set]) => [domain, set.size]),
    ),
    topSources: [...sources.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([source, count]) => ({ source, count })),
  };
}

module.exports = {
  getRelevantContext,
  retrieve,
  retrieveAdaptive,
  listSources,
  corpusStats,
  loadChunks: () => load().chunks,
};
