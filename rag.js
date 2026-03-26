/**
 * rag.js — Local keyword-based retrieval for legal corpus.
 *
 * Architecture: keyword overlap scoring over a JSON chunk store.
 * No external APIs or native binaries required — fully offline.
 * Replacement with vector embeddings (LanceDB + transformers.js) is a drop-in upgrade.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const DATA_PATH = path.join(__dirname, 'legal-data', 'legal-data.json');

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

let _chunks = null;

function loadChunks() {
  if (_chunks) return _chunks;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    _chunks = JSON.parse(raw).chunks;
  } catch (e) {
    console.error('[RAG] Failed to load legal data:', e.message);
    _chunks = [];
  }
  return _chunks;
}

/**
 * Tokenize text into meaningful keywords (lowercase, no stop-words, length ≥ 3).
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Score a chunk against query keywords using TF-weighted overlap.
 */
function scoreChunk(chunk, queryTokens) {
  const combined = `${chunk.title} ${chunk.source} ${chunk.content}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    const re = new RegExp(token, 'gi');
    const matches = combined.match(re);
    if (matches) {
      // Title matches count double
      const titleMatches = (chunk.title.toLowerCase().match(re) || []).length;
      score += matches.length + titleMatches;
    }
  }
  return score;
}

/**
 * Retrieve the top-K most relevant chunks for a given query string.
 *
 * @param {string} query
 * @param {number} topK   — number of chunks to return (default 3)
 * @param {number} minScore — minimum score threshold to include a result
 * @returns {string}  Formatted context block to inject into system prompt
 */
function getRelevantContext(query, topK = 3, minScore = 1) {
  const chunks = loadChunks();
  if (!chunks.length) return '';

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return '';

  const scored = chunks
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (!scored.length) return '';

  return scored
    .map(({ chunk }) => `[${chunk.source}] ${chunk.title}\n${chunk.content}`)
    .join('\n\n---\n\n');
}

/**
 * Return the full list of chunk titles (for debugging / UI listing).
 */
function listSources() {
  return loadChunks().map(c => ({ id: c.id, source: c.source, title: c.title }));
}

module.exports = { getRelevantContext, listSources, loadChunks };
