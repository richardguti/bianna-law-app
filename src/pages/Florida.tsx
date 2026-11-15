import { useEffect, useState } from 'react'
import {
  CURRENCY_RULE,
  KIND_LABEL,
  RESEARCH_CLONE_DIR,
  RESEARCH_SOURCES,
} from '../lib/researchSources'

/**
 * Florida — state primary law, kept separate from everything else.
 *
 * The reason this is its own screen rather than a filter on a search box: a Florida answer and a
 * federal answer are not interchangeable, and the failure mode that matters is a federal rule
 * quietly standing in for a Florida one. Separation is a UI decision that makes that mistake
 * visible.
 *
 * The corpus is a snapshot, so the screen refuses to imply currency it cannot prove. It states
 * the bundle version, and it offers a per-section diff against the Florida Senate, which is the
 * check that actually resolves the question "is this still the text?".
 *
 * Every bridge call is optional — the app must render with no main process, so each one has a
 * stated fallback rather than an empty panel.
 */

interface CorpusStatus {
  bundled: string | null
  bundledVersion: string | null
  bundledFiles: number
  installedVersion: string | null
  installedFiles: number
  expectedVersion: string
}

interface StatuteFields {
  section: string
  catchline: string
  title: string
  chapter: string
  part: string
  source: string
  body: string
}

/**
 * Pull a statute record out of the raw markdown the index stores.
 *
 * The search index hands back the file's text with its front matter intact — `# Fla. Stat. § …`,
 * `**Chapter:**`, `---` — and printing that verbatim into a paragraph is what made the results
 * unreadable: a wall of asterisks and em dashes with the actual provision buried in it. The fields
 * are already labelled in the source, so they are parsed once here and rendered as a record.
 */
function parseStatute(excerpt: string, relPath: string): StatuteFields {
  const flat = String(excerpt || '').replace(/\s+/g, ' ').trim()
  // Everything before the first rule is front matter; everything after is the provision. Splitting
  // once here is what stops the Source field from swallowing the statute body — it is the last
  // labelled field, so without a boundary it runs to the end of the record.
  const ruleAt = flat.indexOf('---')
  const front = ruleAt >= 0 ? flat.slice(0, ruleAt) : flat
  const body = ruleAt >= 0 ? flat.slice(ruleAt + 3).trim() : ''

  const field = (label: string) => {
    const match = front.match(
      new RegExp(`\\*\\*${label}:\\*\\*\\s*(.*?)(?=\\*\\*[A-Z][a-z]+:|$)`, 'i'),
    )
    return match ? match[1].replace(/\*+/g, '').trim() : ''
  }

  const fromPath = relPath.match(/(\d+\.\d+)\.md$/i)
  const section = field('Section') || (fromPath ? fromPath[1] : '') || '—'

  // The heading carries the catchline after an em dash, but some records put the source citation
  // there instead; anything starting "F.S." is not a catchline.
  const heading = front.match(/^#\s*Fla\.\s*Stat\.[^—]*—\s*(.+?)(?=\*\*|$)/i)
  const catchline = heading && !/^F\.S\./i.test(heading[1].trim()) ? heading[1].trim() : ''

  return {
    section,
    catchline,
    title: field('Title'),
    chapter: field('Chapter'),
    part: field('Part'),
    source: field('Source'),
    body: body || flat,
  }
}

/** One statute, shown as a record rather than as its file contents. */
function StatuteResult({ relPath, excerpt }: { relPath: string; excerpt: string }) {
  const [expanded, setExpanded] = useState(false)
  const statute = parseStatute(excerpt, relPath)
  const url = `https://www.flsenate.gov/Laws/Statutes/2025/${statute.section}`

  return (
    <article className="border border-outline-variant bg-surface">
      <header className="px-4 py-3 border-b border-outline-variant flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-serif text-lg text-on-surface leading-none">§ {statute.section}</p>
        {statute.catchline && (
          <p className="text-[13px] text-on-surface-variant leading-snug">{statute.catchline}</p>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="citation ml-auto underline hover:text-on-surface"
        >
          flsenate.gov ↗
        </a>
      </header>

      <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {[
          ['Title', statute.title],
          ['Chapter', statute.chapter],
          ['Part', statute.part],
          ['Source', statute.source],
        ]
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="flex gap-2 min-w-0">
              <dt className="label-micro shrink-0 pt-0.5">{label}</dt>
              <dd className="text-[12px] text-on-surface-variant leading-snug truncate">{value}</dd>
            </div>
          ))}
      </dl>

      <p
        className={`px-4 pb-3 text-[13px] leading-relaxed text-on-surface whitespace-pre-wrap ${
          expanded ? '' : 'line-clamp-4'
        }`}
      >
        {statute.body}
      </p>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
        >
          {expanded ? 'Show less' : 'Show full section'}
        </button>
      </div>
    </article>
  )
}

interface VerifyResult {
  ok?: boolean
  match?: boolean | null
  section?: string
  url?: string
  error?: string
  reason?: string
  fetchedAt?: string
  changes?: string[]
  /** Plain-language explanation composed for the reader, never a raw handler code. */
  message?: string
  offline?: boolean
}

interface SearchHit {
  score: number
  rel: string
  discipline: string
  excerpt: string
}

type Bridge = {
  corpusStatus?: () => Promise<CorpusStatus>
  corpusVerifySection?: (section: string) => Promise<VerifyResult>
  icmSearch?: (args: { query: string; topK: number }) => Promise<SearchHit[]>
} | undefined

const bridge = () => (window as unknown as { seniorPartner?: Bridge }).seniorPartner

export function Florida() {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [section, setSection] = useState('')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [verifying, setVerifying] = useState(false)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    let cancelled = false
    const api = bridge()
    if (!api?.corpusStatus) {
      setStatusError('Corpus status is only readable in the desktop app.')
      return
    }
    void api
      .corpusStatus()
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch(() => {
        if (!cancelled) setStatusError('The corpus status could not be read.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Parse what the user typed into something the verifier can act on.
   *
   * Florida cites as chapter.section — "672.615". A bare "403" is a chapter, not a section, and
   * the verifier correctly refuses it; the mistake was surfacing that refusal as "bad_section" and
   * stopping. Typing a chapter is a reasonable thing to do, so it is treated as a request to look
   * inside that chapter rather than as an error.
   */
  function parseSection(raw: string): { kind: 'empty' | 'exact' | 'chapter'; value: string } {
    const cleaned = raw
      .replace(/[§\s]/g, '')
      .replace(/^(fla|florida)(stat|statute|statutes)?\.?/i, '')
      .replace(/[^0-9.]/g, '')
      .trim()

    if (!cleaned) return { kind: 'empty', value: '' }
    if (/^\d+\.\d+/.test(cleaned)) return { kind: 'exact', value: cleaned.replace(/\.+$/, '') }
    if (/^\d{1,4}$/.test(cleaned)) return { kind: 'chapter', value: cleaned }
    return { kind: 'empty', value: cleaned }
  }

  /** Nearest sections for a chapter or a failed lookup, so a wrong guess still goes somewhere. */
  async function suggest(term: string): Promise<string[]> {
    const api = bridge()
    if (!api?.icmSearch || !term.trim()) return []
    try {
      const results = await api.icmSearch({ query: term, topK: 6 })
      return (Array.isArray(results) ? results : [])
        .map((hit) => hit.rel || '')
        .filter(Boolean)
        .map((rel) => {
          const match = rel.match(/(\d+\.\d+)/)
          return match ? match[1] : rel.split(/[\\/]/).pop() || ''
        })
        .filter((value, index, all) => value && all.indexOf(value) === index)
        .slice(0, 5)
    } catch {
      return []
    }
  }

  async function runVerify() {
    const api = bridge()
    const parsed = parseSection(section)

    if (parsed.kind === 'empty') {
      setVerify({
        message:
          'Enter a Florida section as chapter.section — for example 672.615. A bare number is a chapter, so it needs the section after the dot.',
      })
      return
    }

    if (parsed.kind === 'chapter') {
      setVerifying(true)
      setSuggestions(await suggest(parsed.value))
      setVerify({
        message: `${parsed.value} is a chapter, not a section. Pick a section from chapter ${parsed.value} below, or type one directly — for example ${parsed.value}.01.`,
      })
      setVerifying(false)
      return
    }

    if (!api?.corpusVerifySection) {
      setVerify({ message: 'Verification is only available in the desktop app.' })
      return
    }

    setVerifying(true)
    setVerify(null)
    setSuggestions([])
    try {
      const result = await api.corpusVerifySection(parsed.value)
      if (result.ok === false && result.error) {
        // Never surface the handler's code. Decide what actually happened and say that.
        const offline = result.offline
        const notFound = ['bad_section', 'not_found', 'parse_error'].includes(result.error)
        setSuggestions(await suggest(parsed.value.split('.')[0]))
        setVerify({
          message: offline
            ? `Could not reach the Florida Senate just now, so § ${parsed.value} is unverified. The bundled copy is still available below.`
            : notFound
              ? `§ ${parsed.value} is not a section this corpus recognises. The closest sections are below.`
              : `§ ${parsed.value} could not be checked: ${result.message || 'the source did not answer'}. Sections in the same chapter are below.`,
          url: `https://www.flsenate.gov/Laws/Statutes/2025/${parsed.value}`,
        })
        return
      }
      setVerify(result)
    } catch (error) {
      setSuggestions(await suggest(parsed.value.split('.')[0]))
      setVerify({
        message: `§ ${parsed.value} could not be checked right now${
          error instanceof Error && error.message ? ` (${error.message})` : ''
        }. Sections in the same chapter are below.`,
      })
    } finally {
      setVerifying(false)
    }
  }

  async function runSearch() {
    const api = bridge()
    const clean = query.trim()
    if (!clean) return
    if (!api?.icmSearch) {
      setHits([])
      return
    }
    setSearching(true)
    try {
      const results = await api.icmSearch({ query: clean, topK: 8 })
      setHits(Array.isArray(results) ? results : [])
    } catch {
      setHits([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-8">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">State primary law · Florida</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          Florida, kept separate from federal law
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
          Florida materials live here and nowhere else in the app. A federal rule is not a
          Florida rule, and mixing them is the mistake this screen exists to prevent.
        </p>
      </header>

      {/* ── Currency ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
        <div className="bg-surface p-5">
          <p className="label-micro">Bundled snapshot</p>
          <p className="font-serif text-2xl text-on-surface mt-2 leading-none">
            {status ? status.bundledFiles.toLocaleString() : '—'}
          </p>
          <p className="citation mt-2">
            {status
              ? `sections · version ${status.bundledVersion ?? 'unlabelled'}`
              : statusError ?? 'reading…'}
          </p>
        </div>
        <div className="bg-surface p-5">
          <p className="label-micro">Installed on this machine</p>
          <p className="font-serif text-2xl text-on-surface mt-2 leading-none">
            {status ? status.installedFiles.toLocaleString() : '—'}
          </p>
          <p className="citation mt-2">
            {status
              ? `sections · version ${status.installedVersion ?? 'not installed'}`
              : statusError ?? 'reading…'}
          </p>
        </div>
        <div className="bg-surface p-5">
          <p className="label-micro">Expected</p>
          <p className="font-serif text-2xl text-on-surface mt-2 leading-none">
            {status ? status.expectedVersion : '—'}
          </p>
          <p className="citation mt-2">
            {!status
              ? statusError ?? 'reading…'
              : status.installedVersion === status.expectedVersion
                ? 'In step with the bundle'
                : 'Out of step — sections may be stale'}
          </p>
        </div>
      </section>

      <p className="text-[13px] text-on-surface-variant leading-relaxed max-w-3xl">
        The bundle is a snapshot, not a live feed. Currentness is asserted per section, not for the
        corpus: check the section you intend to rely on against the Florida Senate before you cite
        it.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* ── Section verifier ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Verify a section</h2>
            <p className="citation mt-1">Fetches the section from flsenate.gov and diffs it.</p>
          </div>

          <div className="border border-outline-variant bg-surface p-5 space-y-3">
            <label
              htmlFor="fl-section"
              className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant"
            >
              Section number
            </label>
            <div className="flex gap-2">
              <input
                id="fl-section"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runVerify()
                }}
                placeholder="672.615"
                className="flex-1 bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => void runVerify()}
                disabled={verifying || !section.trim()}
                className="px-5 py-3 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {verifying ? 'Checking…' : 'Verify'}
              </button>
            </div>

            {verify && (
              <div className="hairline-t pt-3 space-y-1.5">
                <p className="label-micro">
                  {verify.message
                    ? 'Needs a different entry'
                    : verify.match === true
                      ? 'Matches the official text'
                      : verify.match === false
                        ? 'Differs from the official text'
                        : 'Fetched, not compared'}
                </p>
                <p className="text-[13px] text-on-surface-variant leading-relaxed">
                  {verify.message ??
                    verify.reason ??
                    (verify.changes?.length
                      ? `${verify.changes.length} change(s) detected.`
                      : 'No differences reported against the version on record.')}
                </p>

                {suggestions.length > 0 && (
                  <div className="pt-1">
                    <p className="label-micro mb-1.5">Closest sections</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          onClick={() => {
                            setSection(candidate)
                            setSuggestions([])
                            setVerify(null)
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 hover:text-on-surface transition-colors"
                        >
                          § {candidate}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {verify.url && (
                  <a
                    href={verify.url}
                    target="_blank"
                    rel="noreferrer"
                    className="citation underline hover:text-on-surface"
                  >
                    Open on flsenate.gov ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Corpus search ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Search the snapshot</h2>
            <p className="citation mt-1">Local full-text over the bundled Florida corpus.</p>
          </div>

          <div className="border border-outline-variant bg-surface p-5 space-y-3">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch()
                }}
                placeholder="force majeure, homestead, notice…"
                className="flex-1 bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching || !query.trim()}
                className="px-5 py-3 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 hover:text-on-surface transition-colors disabled:opacity-40"
              >
                {searching ? '…' : 'Search'}
              </button>
            </div>

            {hits && (
              <div className="space-y-2">
                {hits.length === 0 && (
                  <p className="text-[13px] text-on-surface-variant leading-relaxed">
                    No local matches. That is an absence in the snapshot, not an absence in Florida
                    law — search the Senate site before concluding the provision does not exist.
                  </p>
                )}
                {hits.map((hit) => (
                  <StatuteResult key={hit.rel} relPath={hit.rel} excerpt={hit.excerpt} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Source registry ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <h2 className="font-serif text-2xl text-on-surface">What this build reads</h2>
          <p className="citation mt-1">{CURRENCY_RULE}</p>
        </div>

        <div className="border border-outline-variant divide-y divide-outline-variant">
          {RESEARCH_SOURCES.map((source) => (
            <div key={source.id} className="p-5 bg-surface space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-primary text-on-primary">
                  {KIND_LABEL[source.kind]}
                </span>
                <p className="font-serif text-lg text-on-surface leading-tight">{source.name}</p>
                <span className="citation ml-auto">{source.jurisdiction}</span>
              </div>
              <p className="text-[13px] text-on-surface leading-snug">{source.role}</p>
              <p className="text-[13px] text-on-surface-variant leading-snug">
                Limit: {source.limitation}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-0.5">
                {source.url && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="citation underline hover:text-on-surface"
                  >
                    {source.url.replace(/^https?:\/\//, '')} ↗
                  </a>
                )}
                {source.repo && <span className="citation">github.com/{source.repo}</span>}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[13px] text-on-surface-variant leading-relaxed max-w-3xl">
          The cloned tools live outside the application bundle at{' '}
          <span className="citation">{RESEARCH_CLONE_DIR}</span>. They are code and datasets, not
          law: cloning CourtListener does not make an opinion retrievable, and a benchmark score is
          a statement about a model rather than about the law.
        </p>
      </section>
    </div>
  )
}
