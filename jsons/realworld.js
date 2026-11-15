/**
 * realworld.js — today's news, tied to the rule that governs it.
 *
 * The request was to bring the Oxylabs Google News scraper into the app so doctrine can be checked
 * against the present. The repo itself is Python and writes a CSV; what it actually does is fetch
 * Google News HTML and pull `a.gPFEn` anchors out of it. Three things follow from reading it:
 *
 *   1. THE PYTHON IS NOT THE VALUE. The value is a query against Google News and a parse of the
 *      result. Both are reimplemented here in the main process, so the app does not need a Python
 *      runtime, a virtualenv, or a subprocess boundary to get them.
 *
 *   2. THE FREE PATH IS FRAGILE. `scraper.py` fetches a topic page and relies on one CSS class
 *      surviving Google's next redesign, and its own README concedes it "might fail". Google News
 *      publishes the same corpus as RSS, which is stable, unauthenticated and returns 100 items per
 *      query. That is the default provider. The topic scraper is kept as `topic` for parity with
 *      the repo, and the Oxylabs Web API path is available as `oxylabs` when credentials exist.
 *
 *   3. NEWS IS CONTEXT, NOT AUTHORITY. Nothing here may be cited as law. An article is a claim
 *      that a rule is being applied; the rule itself comes from the corpus, and every answer shows
 *      which doctrine passages were matched and how current those are. The interface says so, and
 *      `correlate()` never upgrades a headline into a holding.
 */

'use strict'

const { retrieveAdaptive, corpusStats, loadChunks } = require('./rag')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const TIMEOUT_MS = 12_000
const MAX_ITEMS = 12

async function fetchText(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers || {}) },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Google News RSS search — the stable, unauthenticated path. */
async function searchRss(query, limit) {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(query) +
    '&hl=en-US&gl=US&ceid=US:en'
  const xml = await fetchText(url)
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || []
  return blocks.slice(0, limit).map((block) => {
    const pick = (tag) => {
      const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return match ? decodeEntities(match[1]) : ''
    }
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)
    const outlet = sourceMatch ? decodeEntities(sourceMatch[1]) : ''
    let title = pick('title')
    // Google appends " - Outlet" to every headline; the outlet is printed separately, so leaving it
    // on the title makes each card read as though it stammers.
    if (outlet && title.toLowerCase().endsWith(` - ${outlet.toLowerCase()}`)) {
      title = title.slice(0, title.length - outlet.length - 3).trim()
    }
    return {
      title,
      link: pick('link'),
      published: pick('pubDate'),
      outlet,
    }
  })
}

/**
 * Topic scrape, mirroring the repo's parser: articles live in `c-wiz` blocks and the anchor that
 * carries the headline is classed `gPFEn`. Written as a tolerant regex rather than a DOM parse so
 * the main process does not need a DOM implementation for one selector.
 */
async function searchTopic(topicId, limit) {
  const url = `https://news.google.com/topics/${encodeURIComponent(topicId)}?hl=en-US&gl=US&ceid=US%3Aen`
  const html = await fetchText(url)
  const anchors = [...html.matchAll(/<a[^>]*class="[^"]*gPFEn[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const fallback = [...html.matchAll(/<a[^>]*href="(\.\/articles\/[^"]+|\.\/read\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  const rows = (anchors.length ? anchors : fallback).slice(0, limit)
  return rows.map((match) => {
    const href = match[1]
    const absolute = href.startsWith('http') ? href : `https://news.google.com/${href.replace(/^\.\//, '')}`
    return {
      title: decodeEntities(match[2].replace(/<[^>]+>/g, '')).slice(0, 200),
      link: absolute,
      published: '',
      outlet: '',
    }
  })
}

/** Oxylabs Web API — the repo's paid path. Only attempted when credentials are configured. */
async function searchOxylabs(query, limit, credentials) {
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')
  const body = JSON.stringify({
    source: 'google_search',
    query,
    // udm 12 switches Google to its News tab, exactly as the repo's README describes.
    udm: 12,
    parse: true,
  })
  const raw = await fetchText('https://realtime.oxylabs.io/v1/queries', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body,
  })
  const parsed = JSON.parse(raw)
  const results = parsed?.results?.[0]?.content?.results?.organic || []
  return results.slice(0, limit).map((entry) => ({
    title: entry.title || '',
    link: entry.url || '',
    published: entry.date || '',
    outlet: entry.source || '',
  }))
}

/**
 * Words that carry a headline but not a doctrine.
 *
 * "Can employers go back to business as usual?" contributes `can`, `back`, `business` and `usual`
 * — none of which name a rule, all of which match something. Removing them before retrieval is
 * what stops a news register from pulling the corpus toward whatever page happens to use the same
 * ordinary words.
 */
const NEWS_NOISE = new Set([
  'can', 'could', 'would', 'should', 'now', 'back', 'after', 'before', 'amid', 'new', 'news',
  'says', 'said', 'what', 'why', 'how', 'here', 'heres', 'business', 'usual', 'more', 'most',
  'first', 'last', 'next', 'still', 'just', 'about', 'over', 'into', 'than', 'then', 'them',
  'they', 'this', 'that', 'with', 'from', 'have', 'has', 'had', 'will', 'may', 'might', 'your',
  'you', 'our', 'its', 'his', 'her', 'their', 'get', 'got', 'make', 'made', 'take', 'took',
])

/**
 * A table row is an index entry, not doctrine.
 *
 * The corpus contains Constitution Annotated tables — lists of case names and years — and they are
 * short, so BM25's length normalisation makes them score higher than a long Restatement passage
 * that is actually on point. A headline about the FTC noncompete rule was matching a row from
 * "Table of Supreme Court Decisions Overruled" because both contain the word "court". Index
 * material is excluded from correlation rather than explained away.
 */
function isIndexMaterial(hit) {
  const source = String(hit.source || '')
  const title = String(hit.title || '')
  const content = String(hit.content || '')
  // Index and administrative shelves: tables of cases, "additional resources" lists, rule-change
  // suggestion logs, bar-review digests. They are legitimate corpus content and useless as the
  // rule in play, so correlation skips them without removing them from ordinary search.
  if (/^table of|additional resources|suggestions|bar review|themis/i.test(`${source} ${title}`)) {
    return true
  }
  if (content.length < 400) return true
  const digits = (content.match(/\d/g) || []).length
  return content.length > 0 && digits / content.length > 0.12
}

function doctrinalQuery(title) {
  return String(title || '')
    .toLowerCase()
    // Hyphens are split, not preserved: "non-compete" kept as one token reads as absent from a
    // corpus that spells it "not to compete", and the word that would have matched is lost.
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !NEWS_NOISE.has(word))
    .join(' ')
}

/**
 * Relevance gate.
 *
 * The first version returned the top three passages whatever their score, and a question about a
 * slayer statute came back with a Commerce Clause summary, a bankruptcy rule and a housing
 * statute — three confident-looking hits, none of them the subject. A headline like "How does the
 * slayer statute relate to the Nick Reiner case?" contributes `statute` and `case`, which appear
 * in most of the corpus, plus `slayer` and `reiner`, which appear in none of it. Matching the
 * common words is not a match; it is a coincidence with a citation attached.
 *
 * So a passage is kept only if it covers a reasonable share of the distinctive query, or contains
 * a genuinely rare term. Anything else is reported as a gap — which is the honest answer, and the
 * one that tells the reader their corpus is missing the doctrine rather than that the law is.
 */
const RARE_DF = 6
const MIN_COVERAGE = 0.34
/** A term in more than this share of the corpus carries no signal; it is a coincidence magnet. */
const UBIQUITY = 0.25

function documentFrequency(tokens) {
  const chunks = loadChunks()
  const df = new Map()
  for (const token of tokens) {
    let count = 0
    for (const chunk of chunks) if (chunk._lc.includes(token)) count += 1
    df.set(token, count)
  }
  return df
}

/**
 * Find the passages that cover the query's distinctive terms.
 *
 * This deliberately does not use the BM25 retriever, and the reason is instructive. On the query
 * "a court has enjoined the FTC non-compete rule", the contracts shelf's covenant-not-to-compete
 * passage never entered the candidate list: it contains `compete` and not `court`, `rule` or `non`,
 * while plenty of other chunks contain three of those common words. BM25 was answering "which
 * chunk best matches this bag of words" — the wrong question. Correlation asks "which passages
 * discuss the thing this headline is about", so it scans for the distinctive terms directly and
 * ranks by how many of them a passage covers.
 */
function findDoctrine(tokens, df, total, domain) {
  const chunks = loadChunks()
  const pool = domain ? chunks.filter((chunk) => chunk.domain === domain) : chunks
  const ubiquitous = (token) => (df.get(token) || 0) > total * UBIQUITY
  const interesting = tokens.filter((token) => (df.get(token) || 0) > 0 && !ubiquitous(token))
  if (!interesting.length) return { hits: [], interesting }

  const scored = []
  for (const chunk of pool) {
    let matchedInteresting = 0
    let rare = 0
    const matchedTokens = []
    for (const token of interesting) {
      if (!chunk._lc.includes(token)) continue
      matchedInteresting += 1
      matchedTokens.push(token)
      if ((df.get(token) || 0) <= RARE_DF) rare += 1
    }
    if (matchedInteresting === 0) continue

    const coverage = matchedInteresting / interesting.length
    // Coverage first, rarity second, and only then the retriever's own score as a tie-break.
    scored.push({
      chunk,
      coverage,
      matchedInteresting,
      matchedTokens,
      rare,
      value: matchedInteresting * 2 + rare * 3 + coverage * 2,
    })
  }

  scored.sort((a, b) => b.value - a.value)
  return { hits: scored, interesting }
}

/**
 * Attach the doctrine that governs each headline.
 *
 * The match is lexical and deliberately loose: a headline is a sentence about the world, not a
 * legal query. What comes back is presented as "the rule in play", never as the article's holding.
 *
 * Note on scope: letting this pick the practice area automatically was tried and removed. Scoring
 * the four domains and taking the winner selected *constitutional* for a noncompete story, because
 * long Constitution Annotated discussions repeat "court" and "rule" more often than the contracts
 * shelf repeats "compete" — volume beat precision, and a confident wrong shelf is worse than an
 * honest cross-cutting one. Without a chosen domain the result is pooled and the interface says so.
 */
function correlate(items, domain) {
  const stats = corpusStats()
  const generatedAt =
    (stats.corpora || []).find((corpus) => corpus.file === 'doctrines.json')?.generatedAt || null
  const total = loadChunks().length

  return items.map((item) => {
    const query = doctrinalQuery(`${item.title}`) || item.title
    const tokens = [...new Set(query.split(/\s+/).filter((token) => token.length > 2))]
    const df = documentFrequency(tokens)
    const absent = tokens.filter((token) => (df.get(token) || 0) === 0 && token.length > 3)

    const { hits } = findDoctrine(tokens, df, total, domain)
    const usable = hits.filter((entry) => !isIndexMaterial(entry.chunk))

    // A passage covers a fair share of the distinctive terms, or contains something genuinely rare
    // in the corpus (a slayer statute, a named doctrine). Two shared common words are not a match:
    // "tenant rights eviction" was returning a case about testamentary restraints on marriage.
    const solid = usable.filter(
      (entry) => (entry.coverage >= 0.5 && entry.matchedInteresting >= 2) || entry.rare > 0,
    )
    let chosen = (solid.length ? solid : usable).slice(0, 3)

    /**
     * If every term that matched is a common word, nothing was matched.
     *
     * "Slayer statute" produced a property passage on insurable interests because both share
     * `trust`-adjacent vocabulary; `trust` occurs in 247 of 2,239 chunks, which is a coincidence of
     * English, not a topical link. When no chosen passage matched a term below this floor, the
     * honest answer is that the library does not cover the subject.
     */
    const SPECIFIC_DF = 120
    const hasSpecific = (entry) =>
      (entry.matchedTokens || []).some((token) => (df.get(token) || 0) <= SPECIFIC_DF)
    if (chosen.length && !chosen.some(hasSpecific)) chosen = []

    /**
     * Three states, because two would lie.
     *
     * `none` is a gap. `partial` means something matched while the subject vocabulary is missing
     * from the library — the closest provisions it holds, not an answer to the question asked.
     * `strong` means the passage covers the distinctive terms and nothing substantial is absent.
     */
    const confidence =
      chosen.length === 0 ? 'none' : solid.length && absent.length === 0 ? 'strong' : 'partial'

    return {
      ...item,
      matchedDomain: domain || null,
      doctrine: chosen.map(({ chunk }) => ({
        source: chunk.source,
        title: chunk.title,
        excerpt: String(chunk.content || '').replace(/\s+/g, ' ').slice(0, 300),
        domain: chunk.domain,
        score: 0,
      })),
      gap: chosen.length === 0,
      confidence,
      gapNote:
        chosen.length === 0
          ? absent.length
            ? `No passage in this corpus covers ${absent.map((token) => `“${token}”`).join(', ')}. This looks like a subject the library does not hold — the absence is in the corpus, not in the law.`
            : 'No passage covers enough of this headline to be a fair match. That is a gap in the corpus, not a conclusion about the rule.'
          : absent.length
            ? `The corpus holds nothing on ${absent.map((token) => `“${token}”`).join(', ')}. These are the closest provisions it does hold — adjacent doctrine, not the rule asked about.`
            : null,
      relaxed: false,
      note: null,
      corpusGeneratedAt: generatedAt,
    }
  })
}

/**
 * What the library actually holds, by foundational subject.
 *
 * "Reconfirm the foundational data is loaded" deserves a number rather than an assurance, so the
 * coverage panel is computed from the corpus on demand: each subject is a set of probe terms and
 * the count is how many chunks contain any of them. A zero is a real gap and is displayed as one.
 */
const COVERAGE_TOPICS = [
  { label: 'Future interests & perpetuities', terms: ['perpetuit', 'fee simple', 'remainder', 'remainder subject to'] },
  { label: 'Property & conveyancing', terms: ['conveyance', 'deed', 'easement', 'covenant runs'] },
  { label: 'Wills, trusts & probate', terms: ['testamentary', 'trustee', 'probate', 'slayer'] },
  { label: 'Contracts & consideration', terms: ['consideration', 'promissory estoppel', 'offer and acceptance'] },
  { label: 'UCC sale of goods', terms: ['uniform commercial code', 'u.c.c', '2-207', 'course of dealing'] },
  { label: 'Torts & negligence', terms: ['negligence', 'duty of care', 'proximate cause', 'strict liability'] },
  { label: 'Constitutional law', terms: ['commerce clause', 'due process', 'equal protection', 'judicial review'] },
  { label: 'Civil procedure', terms: ['summary judgment', 'venue', 'pleading', 'jurisdiction'] },
  { label: 'Evidence', terms: ['hearsay', 'relevance', 'character evidence', 'impeach'] },
  { label: 'Criminal law & procedure', terms: ['mens rea', 'miranda', 'fourth amendment', 'habeas'] },
]

function coverage() {
  const chunks = loadChunks()
  return COVERAGE_TOPICS.map((topic) => {
    const count = chunks.filter((chunk) => topic.terms.some((term) => chunk._lc.includes(term))).length
    return { label: topic.label, chunks: count, present: count > 0 }
  })
}

/**
 * @param {{query?: string, topicId?: string, domain?: string|null, limit?: number,
 *          provider?: 'rss'|'topic'|'oxylabs', credentials?: {username:string,password:string}|null}} args
 */
async function search(args = {}) {
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), MAX_ITEMS)
  const domain = args.domain || null
  const credentials = args.credentials || null

  let provider = args.provider || 'rss'
  if (provider === 'oxylabs' && !credentials) provider = 'rss'

  let items = []
  let degraded = null

  try {
    if (provider === 'topic' && args.topicId) {
      items = await searchTopic(args.topicId, limit)
    } else if (provider === 'oxylabs' && credentials) {
      items = await searchOxylabs(args.query || 'law', limit, credentials)
    } else {
      provider = 'rss'
      items = await searchRss(args.query || 'supreme court ruling', limit)
    }
  } catch (error) {
    // A network failure is not an app failure: say which provider failed and let the caller decide.
    return {
      ok: false,
      provider,
      error: error.message || String(error),
      items: [],
      note: 'The news source could not be reached. Doctrine correlation still works offline from Source Mapping.',
    }
  }

  items = items.filter((item) => item.title)
  if (!items.length) {
    return {
      ok: true,
      provider,
      items: [],
      degraded,
      note: 'No articles came back for that query. Try a broader phrase — "noncompete rule", "AI regulation", "tenant rights".',
    }
  }

  return {
    ok: true,
    provider,
    items: correlate(items, domain),
    note:
      'Headlines are reporting, not authority. The rule in play is drawn from the bundled primary sources and labelled with how current that corpus is.',
  }
}

function status(credentials) {
  const stats = corpusStats()
  return {
    ok: true,
    providers: {
      rss: true,
      topic: true,
      oxylabs: Boolean(credentials && credentials.username && credentials.password),
    },
    corpus: {
      chunks: stats.chunkCount,
      domains: stats.domains,
      generatedAt:
        (stats.corpora || []).find((corpus) => corpus.file === 'doctrines.json')?.generatedAt || null,
    },
    // Carried on the status call so the page can state what the library holds without a second
    // round trip — and so an empty shelf is visible rather than discovered mid-argument.
    coverage: coverage(),
  }
}

module.exports = { search, status, coverage, searchRss, searchTopic, correlate }
