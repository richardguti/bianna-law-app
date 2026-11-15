/**
 * build_doctrine_corpus.js — turn the Leviathan-Law doctrine library into the app's corpus.
 *
 * The source tree is 2.25 GB across 875 files, almost all of it PDF. Shipping that verbatim is
 * not an option and is not the goal: retrieval needs *chunks*, not documents, and a chunk the
 * ranker never reaches is pure weight. So this builder is deliberately lossy in three places,
 * and each one is recorded in the manifest rather than hidden.
 *
 *   1. PER-FILE CAP. A dictionary or code volume yields millions of characters; a keyword
 *      ranker given 10 MB of one book will return only that book. Each file contributes at
 *      most MAX_CHARS, taken from the front, which is where the definitions and sections are.
 *
 *   2. FOLDER PRIORITY. Primary law first (U.S. Code, CFR, UCC, the Federal Rules, the
 *      Restatements), then reference works, then casebooks. If the run is interrupted, what
 *      landed is what was most needed.
 *
 *   3. GARBAGE REFUSAL. A scanned page extracts as noise. Text that is shorter than MIN_CHARS,
 *      or whose letters-to-symbols ratio is poor, is refused and listed, because a silently
 *      empty chunk is worse than a named gap — retrieval will never tell you it is missing.
 *
 * Output: jsons/legal-data/doctrines.json, in the same {id, source, title, content} shape as
 * the hand-written legal-data.json, so rag.js can load both with no special-casing.
 *
 * Usage: node tools/build_doctrine_corpus.js [--limit N] [--max-files N]
 */

'use strict'

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE = 'F:\\Leviathan-Law-Obsidian-Memory\\Leviathan-Law\\50-Legal-Doctrines'
const SOURCE_ROOT = process.env.DOCTRINE_ROOT || DEFAULT_SOURCE
const OUT_DIR = path.join(PROJECT_ROOT, 'jsons', 'legal-data')
const OUT_FILE = path.join(OUT_DIR, 'doctrines.json')

const CHUNK_CHARS = 1400
const MAX_CHARS_PER_FILE = 90_000
/**
 * Retrieval is a linear scan in rag.js, so the corpus size is a latency budget, not a storage
 * budget. Capped per file and overall so adding the library cannot make every query slower.
 * Because files are walked in priority order, what the cap excludes is the back of the shelf.
 */
const MAX_CHUNKS_PER_FILE = 28
const TOTAL_CHUNK_CAP = 9000
const MIN_CHARS = 400
const MIN_LETTER_RATIO = 0.45

/**
 * One malformed or enormous PDF must not stall the whole run.
 *
 * Learned the hard way: the first unbounded run sat on a single volume for two hours at ~4% CPU
 * with no output to show for it, and because results were written only at the end, killing it
 * lost everything. So each file is now bounded in time, and the corpus is checkpointed to disk
 * as it grows — a run that is stopped still leaves a usable corpus behind.
 */
const FILE_TIMEOUT_MS = Number(process.env.DOCTRINE_FILE_TIMEOUT_MS || 90_000)
const CHECKPOINT_EVERY = 10

/**
 * Chunk budget per practice domain.
 *
 * A single flat pool does not partition. The first attempt produced 3,502 of 4,432 chunks filed as
 * 'general' — mostly tax and procurement volumes — and 21 for contracts, because the corpus was
 * assembled by source size rather than by domain. An attorney given 21 contract chunks is a
 * decoration, so each domain gets its own budget, and a file that cannot be charged to a domain
 * with room left is skipped rather than flooding the pool.
 */
const DOMAIN_BUDGET = {
  property: 900,
  contracts: 900,
  constitutional: 900,
  torts: 900,
  criminal: 700,
  barprep: 1200,
  general: 1100,
}

/** Formats we can turn into text. Anything else is recorded as unsupported rather than guessed. */
const SUPPORTED = /\.(pdf|txt|csv|md|html|htm|epub)$/i

const { classifyDomain } = require(path.join(PROJECT_ROOT, 'jsons', 'domain-classifier.js'))

/** Explicit shelf for each DOCTRINE_EXTRA file, set while collecting. */
const EXTRA_SHELF = new Map()

/** Compact domain tally for progress lines, so a stalled run shows which budget it is filling. */
function domainSummary(used) {
  return Object.entries(used)
    .map(([domain, count]) => `${domain}:${count}`)
    .join(' ')
}

function withTimeout(promise, ms, label) {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms)
    if (typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}
/**
 * Code volumes open with a table of contents that is mostly dot leaders. Left in, it is both
 * the largest thing in the file and the least useful — every chunk would be a citation index —
 * and it is also what made an early run refuse the whole U.S. Code for "garbled" text.
 */
const TOC_LINE = /(?:\.{3,}\s*[^.]{0,60}){2,}|\.{6,}/

function clean(raw) {
  const normalised = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, ' ')
    // A page break inside a sentence otherwise becomes a paragraph break.
    .replace(/-\n(?=[a-z])/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')

  const kept = normalised
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return true
      if (TOC_LINE.test(line)) return false
      const dots = (line.match(/\./g) || []).length
      return line.length < 20 || dots / line.length < 0.15
    })
    .join('\n')

  return kept.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Folders that carry doctrine and reference definitions, best first.
 *
 * Order is a curation decision, not a formality. An earlier ordering put the federal code first
 * and the first 160 files came back as tax and procurement volumes: the corpus answered "what
 * does a CFR volume say about anything" and nothing about evidence or contracts, and no ranking
 * change could fix that. Doctrinal sources lead; the code volumes fill in behind them.
 */
const PRIORITY = [
  // Small, high-value sources first: the Model Penal Code and the hand-written criminal notes
  // are a few hundred pages between them, and in the previous ordering they sat behind 848 folder
  // files in a 'general' bucket that filled from the federal rules before ever reaching them —
  // both contributed zero chunks to a library the user had explicitly listed them in.
  'Bianna-Criminal-Law-Notes',
  'Model-Penal-Code',
  'Uniform Commercial Code',
  'FEDERAL RULES OF CIVIL PROCEDURE',
  'Restatement of the law, second, torts',
  'Restatement of the law, second, property',
  // The code volumes last: they are enormous and answer the fewest doctrinal questions per page.
  'United States Code',
  'The Code of Federal Regulations (CFR) annual edition',
]

/**
 * Per top-level folder chunk ceiling.
 *
 * The CFR is 2,884 of the first 160 files' chunks and would be most of any corpus built in file
 * order. A ceiling keeps one publisher from being the whole knowledge base while still letting it
 * contribute; the alternative is a search box that only ever returns regulations.
 */
const FOLDER_CHUNK_CAP = 1200

function chunkText(text, limit) {
  const body = text.slice(0, limit)
  const paragraphs = body.split(/\n{2,}/)
  const chunks = []
  let buffer = ''

  for (const paragraph of paragraphs) {
    const piece = paragraph.trim()
    if (!piece) continue
    if (buffer.length + piece.length + 2 > CHUNK_CHARS && buffer) {
      chunks.push(buffer.trim())
      buffer = ''
    }
    // A single paragraph longer than one chunk is split on sentence boundaries.
    if (piece.length > CHUNK_CHARS) {
      const sentences = piece.split(/(?<=[.!?])\s+/)
      for (const sentence of sentences) {
        if (buffer.length + sentence.length + 1 > CHUNK_CHARS && buffer) {
          chunks.push(buffer.trim())
          buffer = ''
        }
        buffer += (buffer ? ' ' : '') + sentence
      }
    } else {
      buffer += (buffer ? '\n\n' : '') + piece
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim())
  return chunks
}

function letterRatio(text) {
  const sample = text.slice(0, 4000)
  const letters = (sample.match(/[A-Za-z]/g) || []).length
  return sample.length ? letters / sample.length : 0
}

/**
 * Take a stratified sample of a whole document, rather than its first N characters.
 *
 * This was the quiet reason the corpus under-represented every large book. Capping at 90,000
 * characters from the front meant the Restatement of Contracts contributed 28 chunks of table of
 * contents — "§ 1. Contract Defined § 2. Promise; Promisor…" — and none of its actual text, and
 * the same was true of Black's, Chemerinsky and the Prosser casebook. Reading the whole document
 * and taking every Nth chunk spreads the sample across chapters, and skipping the opening 5%
 * drops the front matter that produced the problem.
 */
function sampleChunks(text, maxChunks) {
  const all = chunkText(text, Number.MAX_SAFE_INTEGER)
  if (all.length <= maxChunks) return all

  const skip = Math.floor(all.length * 0.05)
  const pool = all.slice(skip)
  if (pool.length <= maxChunks) return pool

  const step = pool.length / maxChunks
  const picked = []
  for (let i = 0; i < maxChunks; i += 1) {
    picked.push(pool[Math.min(pool.length - 1, Math.floor(i * step))])
  }
  return picked
}

function titleFromFile(fileName) {
  return fileName
    .replace(/\.(pdf|txt|csv|md|epub|mobi)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Read the doctrine path, excluding PDFs as a separate pass so text files always land. */
function collectFiles() {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (SUPPORTED.test(entry.name)) out.push(full)
    }
  }
  walk(SOURCE_ROOT, 0)

  /**
   * Books that live outside the library folder.
   *
   * `DOCTRINE_EXTRA` takes entries separated by semicolons or newlines. Each entry may be:
   *   path                     — ingested and classified like a library file
   *   domain|path              — ingested and filed under `domain`, skipping the classifier
   *   path-to-a-folder         — every supported file inside it, walked recursively
   *
   * The `domain|` prefix exists because a shelf is a decision, not an inference. A machine-learning
   * textbook and a Florida test-specification packet have no vocabulary the law classifier
   * recognises, so without an explicit shelf they would both land in `general` and be unreachable
   * from the exam that needs them.
   */
  const extras = String(process.env.DOCTRINE_EXTRA || '')
    // Semicolons and newlines only. Splitting on commas silently shredded a real path —
    // "… -- 1, 5, 2026 -- Wolters Kluwer …" became four fragments, none of which existed, and the
    // textbook was skipped without an error.
    .split(/[;\r\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  for (const entry of extras) {
    // Only the first bar separates the shelf; Windows paths contain none, but a title might.
    const separator = entry.indexOf('|')
    const shelf = separator > 0 && !/[\\/]/.test(entry.slice(0, separator)) ? entry.slice(0, separator).trim() : null
    const target = (separator > 0 && shelf ? entry.slice(separator + 1) : entry).trim()
    if (!fs.existsSync(target)) {
      console.log(`[corpus] extra not found, skipped: ${target}`)
      continue
    }

    const files = []
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      const pending = [target]
      while (pending.length) {
        const dir = pending.pop()
        for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, child.name)
          if (child.isDirectory()) pending.push(full)
          else if (SUPPORTED.test(full)) files.push(full)
        }
      }
    } else if (SUPPORTED.test(target)) {
      files.push(target)
    }

    for (const file of files) {
      const resolved = path.resolve(file)
      out.push(resolved)
      if (shelf) EXTRA_SHELF.set(resolved, shelf)
    }
    if (files.length) console.log(`[corpus] extra ${shelf || 'auto'}: ${files.length} file(s) from ${path.basename(target)}`)
  }

  const rank = (file) => {
    const rel = path.relative(SOURCE_ROOT, file)
    const index = PRIORITY.findIndex((folder) => rel.toLowerCase().startsWith(folder.toLowerCase()))
    // PDFs before loose .txt. The Restatement folders carry both, and the .txt files are 1“3 KB
    // page fragments from the scan: leading with them spends the file budget on splinters while
    // the actual volume sits behind them, which is exactly what a 220-file run did.
    const isFragment = /\.(txt|csv|md)$/i.test(file) ? 1 : 0
    return (index < 0 ? PRIORITY.length : index) * 10 + isFragment
  }

  return out.sort((a, b) => rank(a) - rank(b))
}

/**
 * Interleave files round-robin by their *apparent* domain, so no single domain is starved before
 * the others begin. This uses cheap path-and-filename classification only — reading 873 files to
 * decide their order would cost the extraction twice. The authoritative domain is assigned after
 * extraction, from the text itself.
 *
 * Files sitting at the library root are always placed first, in one block. They are the curated
 * core — Restatement of Contracts, Prosser, Black's, Chemerinsky, the Constitution itself — and in
 * an earlier ordering they sorted last, behind 848 folder files, so the domain budgets filled and
 * 21 of 25 were never read. Depth-first into subfolders was exactly the wrong instinct.
 */
function interleaveByDomain(files) {
  const rootFiles = []
  const buckets = new Map()

  for (const file of files) {
    const rel = path.relative(SOURCE_ROOT, file)
    if (!rel.includes(path.sep)) {
      rootFiles.push(file)
      continue
    }
    const { domain } = classifyDomain(`${rel} ${titleFromFile(path.basename(file))}`)
    if (!buckets.has(domain)) buckets.set(domain, [])
    buckets.get(domain).push(file)
  }

  const names = [...buckets.keys()]
  const out = [...rootFiles]
  let index = 0
  while (out.length < files.length) {
    let placed = false
    for (const name of names) {
      const bucket = buckets.get(name)
      if (index < bucket.length) {
        out.push(bucket[index])
        placed = true
      }
    }
    if (!placed) break
    index += 1
  }
  return out
}

async function extractPdf(file) {
  // Required lazily so a text-only run works even if the PDF engine is absent.
  const { PDFParse } = require('pdf-parse')
  const parser = new PDFParse({ data: fs.readFileSync(file) })
  try {
    const result = await parser.getText()
    return result.text || ''
  } finally {
    await parser.destroy().catch(() => {})
  }
}

/** Strip markup to readable text, keeping paragraph breaks where block elements end. */
function stripHtml(html) {
  return String(html)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

/**
 * Read an EPUB. It is a ZIP of XHTML in the spine order defined by the OPF, but chapter filenames
 * sort close enough to reading order for a retrieval corpus, and a mis-ordered chapter costs a
 * reader nothing once it has been chunked. `jszip` is already a dependency of the renderer.
 */
async function extractEpub(file) {
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const pages = Object.keys(zip.files)
    .filter((name) => /\.(xhtml|html|htm)$/i.test(name) && !zip.files[name].dir)
    .sort()

  const parts = []
  for (const name of pages) {
    const html = await zip.files[name].async('string')
    const text = stripHtml(html).trim()
    if (text) parts.push(text)
  }
  return parts.join('\n\n')
}

async function main() {
  const argv = process.argv.slice(2)
  const argOf = (flag) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? Number(argv[index + 1]) : undefined
  }
  const maxFiles = argOf('--max-files') ?? Infinity
  /**
   * Wall-clock ceiling. Bounding by file count is the wrong knob — 220 files can mean 20 volumes
   * or 220 splinters — so a run is bounded by time and the chunk caps, and whatever it reached is
   * checkpointed and usable.
   */
  const maxMinutes = argOf('--max-minutes') ?? Infinity
  const deadline = Date.now() + maxMinutes * 60_000

  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`Source not found: ${SOURCE_ROOT}`)
    process.exit(1)
  }

  const files = interleaveByDomain(collectFiles().slice(0, maxFiles))
  console.log(`[corpus] ${files.length} candidate files under ${SOURCE_ROOT}`)

  const chunks = []
  const refused = []
  const failed = []
  const perFolder = new Map()
  const domainUsed = Object.fromEntries(Object.keys(DOMAIN_BUDGET).map((d) => [d, 0]))
  const started = Date.now()
  let done = 0
  let skippedByCap = 0
  let skippedByDomain = 0

  /**
   * Write the corpus as it stands. Called periodically and once at the end.
   *
   * Written to a sibling file and renamed into place, so a consumer reading `doctrines.json`
   * mid-build never sees a half-written file, and an interrupted run leaves the previous
   * complete corpus intact rather than replacing it with a smaller partial one.
   */
  const flush = (label) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const temp = `${OUT_FILE}.tmp`
    fs.writeFileSync(
      temp,
      JSON.stringify({
        version: '1.0',
        source: 'Leviathan-Law / 50-Legal-Doctrines',
        generatedAt: new Date().toISOString(),
        chunkChars: CHUNK_CHARS,
        maxCharsPerFile: MAX_CHARS_PER_FILE,
        checkpoint: label,
        fileCount: files.length - failed.length - refused.length,
        skippedByCap,
        skippedByDomain,
        domains: domainUsed,
        chunkCount: chunks.length,
        refused,
        failed,
        chunks,
      }),
    )
    fs.renameSync(temp, OUT_FILE)
  }

  for (const file of files) {
    if (chunks.length >= TOTAL_CHUNK_CAP) {
      console.log(`[corpus] chunk cap of ${TOTAL_CHUNK_CAP} reached — remaining files skipped`)
      break
    }
    if (Date.now() > deadline) {
      console.log(`[corpus] time limit of ${maxMinutes} min reached — stopping with what was read`)
      break
    }
    done += 1
    const rel = path.relative(SOURCE_ROOT, file)
    const isExternal = rel.startsWith('..')
    const folder = isExternal ? 'added-library' : rel.split(path.sep)[0]
    // A file at the library root has no directory, and `path.dirname` answers '.', which then
    // renders as a source named "." in the UI. Name the shelf instead.
    const relDir = path.dirname(rel)
    const source = isExternal
      ? 'Added library'
      : relDir === '.'
        ? 'Doctrine library'
        : relDir.split(path.sep).slice(0, 2).join(' / ')
    const title = titleFromFile(path.basename(file))

    if ((perFolder.get(folder) || 0) >= FOLDER_CHUNK_CAP) {
      skippedByCap += 1
      continue
    }

    /**
     * Cheap pre-check, and deliberately conservative.
     *
     * Extracting a 40 MB volume costs a minute; if the domain it will be charged to is already
     * full, that minute buys nothing. But the filename estimate is unreliable — a Restatement of
     * Contracts named in the root folder looks like 'general' — so root-level documents are never
     * skipped on this basis. They are the curated core of the library, and dropping one because a
     * folder had already filled a quota is the opposite of curation.
     */
    const isRootDocument = isExternal || !rel.includes(path.sep)
    // An explicit shelf beats an inferred one, both for the budget check and for the chunk itself.
    const likelyDomain = EXTRA_SHELF.get(file) || classifyDomain(`${rel} ${title}`).domain
    if (!isRootDocument && domainUsed[likelyDomain] >= (DOMAIN_BUDGET[likelyDomain] ?? 0)) {
      skippedByDomain += 1
      if (done % CHECKPOINT_EVERY === 0) {
        flush(`after ${done} files`)
        console.log(`[corpus] ${done}/${files.length} files · ${chunks.length} chunks · ${domainSummary(domainUsed)}`)
      }
      continue
    }

    let text = ''
    try {
      if (/\.pdf$/i.test(file)) {
        text = clean(await withTimeout(extractPdf(file), FILE_TIMEOUT_MS, rel))
      } else if (/\.epub$/i.test(file)) {
        text = clean(await withTimeout(extractEpub(file), FILE_TIMEOUT_MS, rel))
      } else if (/\.mobi$/i.test(file)) {
        // No MOBI reader is available and guessing at the format would produce noise in the corpus.
        failed.push({ file: rel, reason: 'mobi not supported — convert to epub or text' })
        if (done % CHECKPOINT_EVERY === 0) flush(`after ${done} files`)
        continue
      } else if (/\.(html|htm)$/i.test(file)) {
        text = clean(stripHtml(fs.readFileSync(file, 'utf8')))
      } else {
        text = clean(fs.readFileSync(file, 'utf8'))
      }
    } catch (error) {
      failed.push({ file: rel, reason: String(error.message || error).slice(0, 160) })
      if (done % CHECKPOINT_EVERY === 0) flush(`after ${done} files`)
      continue
    }

    if (text.length < MIN_CHARS) {
      refused.push({ file: rel, reason: `only ${text.length} chars`, kind: 'short' })
      continue
    }
    /**
     * The letter-ratio guard exists to catch a scanned page that extracted as noise. It must not
     * be applied to tabular data: the Constitution Annotated case tables are mostly citations,
     * numerals and delimiters, so they score around 0.3 and were being refused as "garbled" when
     * they were in fact perfectly clean CSV.
     */
    const isStructured = /\.(csv|json|tsv)$/i.test(file)
    if (!isStructured && letterRatio(text) < MIN_LETTER_RATIO) {
      refused.push({ file: rel, reason: `letter ratio ${letterRatio(text).toFixed(2)}`, kind: 'garbled' })
      continue
    }

    // The authoritative domain comes from the text, not the filename: a volume called
    // "Examples & Explanations for Property" is property, and a tax regulation is not. An explicit
    // shelf from DOCTRINE_EXTRA overrides that, because it is a decision rather than a guess.
    const domain = EXTRA_SHELF.get(file) || classifyDomain(`${rel} ${title} ${text.slice(0, 3000)}`).domain
    const budget = DOMAIN_BUDGET[domain] ?? 0
    if (!isRootDocument && domainUsed[domain] >= budget) {
      skippedByDomain += 1
      if (done % CHECKPOINT_EVERY === 0) flush(`after ${done} files`)
      continue
    }

    const fileChunks = sampleChunks(text, MAX_CHUNKS_PER_FILE)
    for (const [index, content] of fileChunks.entries()) {
      if (chunks.length >= TOTAL_CHUNK_CAP) break
      if ((perFolder.get(folder) || 0) >= FOLDER_CHUNK_CAP) break
      if (!isRootDocument && domainUsed[domain] >= budget) break
      perFolder.set(folder, (perFolder.get(folder) || 0) + 1)
      domainUsed[domain] = (domainUsed[domain] || 0) + 1
      chunks.push({
        id: `doc-${chunks.length}`,
        source,
        title: index === 0 ? title : `${title} (${index + 1})`,
        content,
        // Carried into the corpus so retrieval can filter without reclassifying per query.
        domain,
      })
    }

    if (done % CHECKPOINT_EVERY === 0 || done === files.length) {
      flush(`after ${done} files`)
      const mb = (JSON.stringify(chunks).length / 1024 / 1024).toFixed(1)
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      console.log(
        `[corpus] ${done}/${files.length} files · ${chunks.length} chunks · ${mb} MB · ${secs}s`,
      )
    }
  }

  flush('final')

  const sizeMb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)
  console.log(
    `[corpus] wrote ${OUT_FILE} — ${chunks.length} chunks, ${sizeMb} MB, ` +
      `${refused.length} refused, ${failed.length} failed, ${skippedByCap} past the folder cap, ` +
      `${skippedByDomain} past a domain budget`,
  )
  console.log(
    '[corpus] by domain: ' +
      Object.entries(domainUsed)
        .map(([domain, count]) => `${domain}=${count}`)
        .join('  '),
  )
}

main().catch((error) => {
  console.error('[corpus] fatal:', error)
  process.exit(1)
})
