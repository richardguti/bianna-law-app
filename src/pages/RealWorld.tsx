import { useCallback, useEffect, useState } from 'react'

/**
 * Real World Explainer — today's reporting, next to the rule that governs it.
 *
 * The mode exists to answer a question a headnote cannot: when a court does something, *which* rule
 * is actually in play, and how current is the copy we hold? So each headline is paired with the
 * doctrine passages the retriever matched, and every page carries the corpus generation date so a
 * stale answer is visible as stale rather than merely old.
 *
 * The one rule this screen enforces on itself: news is context, never authority. A headline is a
 * claim that a rule is being applied — often loosely, sometimes wrongly. The law in the panel is
 * the bundled primary text, and the interface says which is which rather than blurring them.
 */

interface DoctrineHit {
  source: string
  title: string
  excerpt: string
  domain?: string
  score: number
}

interface Story {
  title: string
  link: string
  published: string
  outlet: string
  doctrine: DoctrineHit[]
  /** strong = covers the distinctive terms; partial = closest the library holds; none = a gap */
  confidence?: 'strong' | 'partial' | 'none'
  gap?: boolean
  gapNote?: string | null
  relaxed?: boolean
  note?: string | null
  corpusGeneratedAt?: string | null
}

const DOMAINS: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'All domains' },
  { id: 'property', label: 'Property' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'constitutional', label: 'Constitutional' },
  { id: 'torts', label: 'Torts' },
]

const SUGGESTIONS = [
  'noncompete rule court',
  'AI regulation compliance',
  'tenant rights eviction ruling',
  'data breach notification',
  'force majeure contract dispute',
]

function formatDate(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 24)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function RealWorld() {
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState<string | null>(null)
  const [stories, setStories] = useState<Story[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [corpus, setCorpus] = useState<{ chunks: number; generatedAt: string | null } | null>(null)
  const [providers, setProviders] = useState<{ oxylabs: boolean } | null>(null)
  const [coverage, setCoverage] = useState<Array<{ label: string; chunks: number }> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await window.seniorPartner?.realWorldStatus?.()
        if (cancelled || !status?.ok) return
        setProviders({ oxylabs: Boolean(status.providers?.oxylabs) })
        setCorpus({
          chunks: status.corpus?.chunks ?? 0,
          generatedAt: status.corpus?.generatedAt ?? null,
        })
        setCoverage(
          (status.coverage ?? []).map((entry) => ({ label: entry.label, chunks: entry.chunks })),
        )
      } catch {
        /* the panel degrades to "no corpus reading" rather than failing the page */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (searchTerm?: string) => {
      const term = (searchTerm ?? query).trim()
      if (!term) {
        setError('Enter a subject — a doctrine, a rule, or a phrase from the news.')
        return
      }
      setBusy(true)
      setError(null)
      setNote(null)
      try {
        const result = await window.seniorPartner?.realWorldSearch?.({
          query: term,
          domain,
          limit: 6,
        })
        if (!result?.ok) {
          setStories([])
          setError(result?.note || result?.error || 'The news search did not return a result.')
          return
        }
        setStories(result.items)
        setNote(result.note ?? null)
      } catch (err) {
        setStories([])
        setError(err instanceof Error ? err.message : 'The news search failed.')
      } finally {
        setBusy(false)
      }
    },
    [query, domain],
  )

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-8">
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">Real World Explainer</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          What happened, and which rule it put in play
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
          Takes a doctrine — or just today&apos;s news — and shows the primary text that governs it.
          The reporting is context; the rule in the panel is the authority, and every entry carries
          the date the corpus was built so you can see how current it is.
        </p>
      </header>

      {/* ── Query ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run()
            }}
            placeholder="A doctrine, a rule, or a phrase from the news…"
            className="flex-1 bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="px-6 py-3 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {busy ? 'Reading the news…' : 'Explain it →'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DOMAINS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setDomain(option.id)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                domain === option.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="citation ml-auto">
            {corpus
              ? `corpus ${corpus.chunks.toLocaleString()} passages · built ${
                  corpus.generatedAt ? formatDate(corpus.generatedAt) : 'unknown'
                }`
              : 'corpus not readable'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setQuery(suggestion)
                void run(suggestion)
              }}
              className="px-2.5 py-1 text-[11px] border border-outline-variant text-on-surface-variant hover:border-primary/40 hover:text-on-surface transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-on-surface-variant border-l-2 border-accent pl-3 leading-snug">
          {error}
        </p>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {stories && stories.length > 0 && (
        <section className="space-y-4">
          {note && <p className="citation leading-relaxed">{note}</p>}
          {!domain && (
            <p className="text-[13px] text-on-surface-variant leading-snug">
              Matched across every practice area. Choosing one above narrows the shelf, and a
              narrower shelf gives a sharper rule — pooled matching favours whichever volume repeats
              the headline&apos;s common words most.
            </p>
          )}

          {stories.map((story, index) => (
            <article key={`${story.link}-${index}`} className="border border-outline-variant bg-surface">
              {/* The reporting */}
              <header className="px-5 py-4 border-b border-outline-variant">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-secondary-container text-on-secondary-container">
                    Reported
                  </span>
                  <span className="citation">{story.outlet || 'News'}</span>
                  {story.published && <span className="citation">· {formatDate(story.published)}</span>}
                  <a
                    href={story.link}
                    target="_blank"
                    rel="noreferrer"
                    className="citation ml-auto underline hover:text-on-surface"
                  >
                    read the source ↗
                  </a>
                </div>
                <p className="font-serif text-lg text-on-surface leading-snug mt-2">{story.title}</p>
              </header>

              {/* The rule */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="label-micro">The rule in play — from the bundled primary sources</p>
                  <span
                    className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                      story.confidence === 'strong'
                        ? 'bg-verdict-green-soft text-verdict-green'
                        : story.confidence === 'partial'
                          ? 'bg-verdict-yellow-soft text-verdict-yellow'
                          : 'bg-surface-container-high text-on-surface-variant'
                    }`}
                  >
                    {story.confidence === 'strong'
                      ? 'Matched'
                      : story.confidence === 'partial'
                        ? 'Closest available'
                        : 'Not in corpus'}
                  </span>
                </div>

                {story.gapNote && (
                  <p
                    className={`text-[13px] leading-snug border-l-2 pl-3 ${
                      story.confidence === 'strong'
                        ? 'border-outline-variant text-on-surface-variant'
                        : 'border-verdict-yellow text-on-surface-variant'
                    }`}
                  >
                    {story.gapNote}
                  </p>
                )}

                {story.doctrine.length === 0 && !story.gapNote && (
                  <p className="text-[13px] text-on-surface-variant leading-relaxed">
                    No doctrine passage matched this headline. That is a gap in the corpus or a
                    phrasing mismatch, not a conclusion that no rule applies.
                  </p>
                )}

                {story.doctrine.map((hit, hitIndex) => (
                  <div key={`${hit.title}-${hitIndex}`} className="border-l-2 border-outline-variant pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="citation">{hit.source}</p>
                      {hit.domain && <span className="citation">· {hit.domain}</span>}
                    </div>
                    <p className="text-[13px] text-on-surface leading-snug mt-0.5">{hit.title}</p>
                    <p className="text-[13px] text-on-surface-variant leading-snug mt-1">
                      {hit.excerpt}…
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {stories && stories.length === 0 && !error && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl text-outline-variant">newspaper</span>
          <p className="font-serif text-xl text-on-surface">Nothing came back</p>
          <p className="text-sm max-w-md leading-relaxed">
            Try a broader phrase. The doctrine engine still works without news — Source Mapping
            searches the corpus directly.
          </p>
        </div>
      )}

      {/* ── What the library holds ───────────────────────────────────────── */}
      {coverage && coverage.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">What this build actually holds</h2>
            <p className="label-micro">chunks per subject</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
            {coverage.map((entry) => (
              <div key={entry.label} className="bg-surface px-4 py-3 flex items-baseline gap-3">
                <span
                  className={`font-serif text-xl leading-none ${
                    entry.chunks === 0 ? 'text-verdict-red' : 'text-on-surface'
                  }`}
                >
                  {entry.chunks}
                </span>
                <span className="text-[13px] text-on-surface-variant leading-snug">
                  {entry.label}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-on-surface-variant leading-relaxed max-w-3xl">
            Counts are passages containing any of that subject&apos;s terms, computed from the
            corpus on each load. A zero is a genuine gap — the explainer will say so rather than
            substitute an adjacent rule.
          </p>
        </section>
      )}

      {/* ── Standing caveat ──────────────────────────────────────────────── */}
      <section className="bg-surface-container-low border border-outline-variant p-5 space-y-2">
        <p className="label-micro">How to read this</p>
        <p className="text-[13px] text-on-surface-variant leading-relaxed">
          A headline is a report that a rule was applied; it is not the rule, and it is not a
          holding. The doctrine passages are drawn from the bundled U.S. Code, CFR, Restatements,
          UCC, cases and the Florida statutes, and each carries the corpus build date rather than a
          promise of currency — verify anything you intend to rely on against the official source.
        </p>
        {providers && !providers.oxylabs && (
          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            News is currently read through Google News RSS, which needs no account. The Oxylabs Web
            API path used by the original scraper is available if credentials are added; it is not
            required for this mode to work.
          </p>
        )}
      </section>
    </div>
  )
}
