import { useEffect, useMemo, useState } from 'react'
import {
  effectiveWeight,
  freshnessOf,
  mapClaim,
  providerById,
  rankAuthorities,
  summarise,
  verificationOf,
} from '../lib/legalLogic'
import type { Authority, CitatorStatus, ElementResult, Triage } from '../lib/legalLogic'
import { EXCUSE_RULE, seedAuthorities, seedElementResults } from '../lib/legalFixtures'

/**
 * Sources — the authority engine, made inspectable.
 *
 * The claim this screen has to earn is that the conclusion below is *computed*, not asserted.
 * So nothing here is a stored verdict: the disposition, the confidence, the ranking of the
 * authorities and the RED/YELLOW/GREEN all fall out of two pieces of state a reader can move
 * — each element's finding, and each authority's citator status.
 *
 * Two interactions are deliberately the same shape, because they are the same question:
 * "what changes if this is not what we thought?" Mark the MSA clause superseded and the
 * conclusion collapses, because the contract is what governs before the statute does.
 */

const CLAIM =
  'Non-payment of the Q3 invoices is excused under § 11.4 because the supplier shutdown was unforeseeable.'

const TIER_LABEL: Record<Authority['tier'], string> = {
  constitution: 'Constitution',
  statute: 'Statute',
  regulation: 'Regulation',
  'procedural-rule': 'Procedural rule',
  'case-binding': 'Binding case',
  'case-persuasive': 'Persuasive case',
  secondary: 'Secondary',
  'practice-document': 'Practice doc',
}

// Complete literal strings — a class assembled from a fragment is invisible to Tailwind.
const STATUS_STYLE: Record<CitatorStatus, string> = {
  'good-law': 'bg-verdict-green-soft text-verdict-green',
  caution: 'bg-verdict-yellow-soft text-verdict-yellow',
  questioned: 'bg-verdict-yellow-soft text-verdict-yellow',
  superseded: 'bg-verdict-red-soft text-verdict-red',
  overruled: 'bg-verdict-red-soft text-verdict-red',
  unknown: 'bg-surface-container-high text-on-surface-variant',
}

const STATUS_CYCLE: CitatorStatus[] = [
  'good-law',
  'caution',
  'questioned',
  'superseded',
  'overruled',
  'unknown',
]

const VERDICT_STYLE: Record<Triage, string> = {
  green: 'bg-verdict-green-soft text-verdict-green',
  yellow: 'bg-verdict-yellow-soft text-verdict-yellow',
  red: 'bg-verdict-red-soft text-verdict-red',
}

const FINDING_STYLE: Record<ElementResult['finding'], string> = {
  satisfied: 'bg-verdict-green-soft text-verdict-green',
  unclear: 'bg-verdict-yellow-soft text-verdict-yellow',
  'not-satisfied': 'bg-verdict-red-soft text-verdict-red',
  'not-addressed': 'bg-surface-container-high text-on-surface-variant',
}

const FINDING_CYCLE: ElementResult['finding'][] = [
  'satisfied',
  'unclear',
  'not-satisfied',
  'not-addressed',
]

const DISPOSITION_LABEL: Record<string, string> = {
  established: 'Established',
  contested: 'Contested',
  unsupported: 'Unsupported',
  declined: 'Declined to conclude',
}

interface CorpusStats {
  chunkCount: number
  sourceCount: number
  corpora: Array<{ file: string; chunks: number; version: string | null; generatedAt: string | null }>
  topSources: Array<{ source: string; count: number }>
}

interface CorpusHit {
  id: string
  source: string
  title: string
  excerpt: string
  score: number
}

/**
 * The local knowledge base, made visible.
 *
 * A corpus nothing can see is indistinguishable from no corpus: the app would claim to ship a
 * doctrine library and a user could never confirm it, search it, or notice it was stale. This
 * panel reads the same `rag.js` the assistant grounds on, so what is shown here is exactly what
 * the model is given.
 */
function KnowledgeBase() {
  const [stats, setStats] = useState<CorpusStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CorpusHit[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.seniorPartner?.ragStats?.()
        if (cancelled) return
        if (!result?.success) {
          setError(result?.error ?? 'The corpus is only readable in the desktop app.')
          return
        }
        setStats({
          chunkCount: result.chunkCount ?? 0,
          sourceCount: result.sourceCount ?? 0,
          corpora: result.corpora ?? [],
          topSources: result.topSources ?? [],
        })
      } catch {
        if (!cancelled) setError('The corpus could not be read.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function search() {
    const clean = query.trim()
    if (!clean) return
    setBusy(true)
    try {
      const result = await window.seniorPartner?.ragSearch?.({ query: clean, topK: 5 })
      setHits(result?.hits ?? [])
      // The retriever reports how hard it had to try; surfacing that is the difference between a
      // weak match presented as fact and a weak match presented as a starting point.
      setNote(result?.note ?? null)
    } catch {
      setHits([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between border-b border-outline-variant pb-2">
        <h2 className="font-serif text-2xl text-on-surface">Local knowledge base</h2>
        <p className="label-micro">
          {stats ? `${stats.chunkCount.toLocaleString()} chunks · ${stats.sourceCount} sources` : 'reading…'}
        </p>
      </div>

      {error && <p className="text-[13px] text-on-surface-variant">{error}</p>}

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant border border-outline-variant">
          {stats.corpora.map((corpus) => (
            <div key={corpus.file} className="bg-surface p-5">
              <p className="label-micro">{corpus.file}</p>
              <p className="font-serif text-2xl text-on-surface mt-2 leading-none">
                {corpus.chunks.toLocaleString()}
              </p>
              <p className="citation mt-2">
                {corpus.generatedAt
                  ? `generated ${corpus.generatedAt.slice(0, 10)}`
                  : 'hand-maintained seed set'}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="border border-outline-variant bg-surface p-5 space-y-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search()
            }}
            placeholder="supplemental jurisdiction, force majeure, homestead…"
            className="flex-1 bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={busy || !query.trim()}
            className="px-5 py-3 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {busy ? '…' : 'Search'}
          </button>
        </div>

        {hits && (
          <div className="space-y-2">
            {note && (
              <p className="text-[13px] text-on-surface-variant leading-snug border-l-2 border-outline-variant pl-3">
                {note}
              </p>
            )}
            {hits.length === 0 && !note && (
              <p className="text-[13px] text-on-surface-variant leading-relaxed">
                No local match. That is a gap in the corpus, not an absence in the law.
              </p>
            )}
            {hits.map((hit) => (
              <div key={hit.id} className="hairline-t pt-2">
                <div className="flex items-center gap-2">
                  <p className="citation">{hit.source}</p>
                  {/* BM25 scores are floats with long tails; two decimals is the most that is
                      meaningful to a reader comparing ranks. */}
                  <span className="citation ml-auto">score {hit.score.toFixed(1)}</span>
                </div>
                <p className="text-[13px] text-on-surface leading-snug mt-1">{hit.title}</p>
                <p className="text-[13px] text-on-surface-variant leading-snug mt-1">
                  {hit.excerpt}…
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function Sources() {
  const [authorities, setAuthorities] = useState<Authority[]>(seedAuthorities)
  const [results, setResults] = useState<ElementResult[]>(seedElementResults)

  const mapping = useMemo(
    () => mapClaim(CLAIM, EXCUSE_RULE, results, authorities),
    [results, authorities],
  )
  const summary = useMemo(() => summarise([mapping], authorities), [mapping, authorities])
  const ranked = useMemo(() => rankAuthorities(authorities), [authorities])

  function cycleStatus(id: string) {
    setAuthorities((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(a.status) + 1) % STATUS_CYCLE.length]
        return { ...a, status: next }
      }),
    )
  }

  function cycleFinding(elementId: string) {
    setResults((prev) =>
      prev.map((r) => {
        if (r.elementId !== elementId) return r
        const next = FINDING_CYCLE[(FINDING_CYCLE.indexOf(r.finding) + 1) % FINDING_CYCLE.length]
        return { ...r, finding: next }
      }),
    )
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">Authority engine · Source mapping</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          Every conclusion points at its text
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
          A finding is anchored to a character range in a source, weighed by tier and citator
          status, and only then allowed to support a conclusion. Change a status or a finding
          and watch the verdict re-derive.
        </p>
        <p className="text-[13px] text-on-surface-variant mt-3 leading-snug max-w-3xl border-l-2 border-outline-variant pl-3">
          The worked example is a teaching scenario. Its authorities are supplied with the exercise
          and are <em>not</em> drawn from the bundled corpus — the corpus does not hold
          <em> Transatlantic</em> or <em>Lloyd v. Murphy</em>. The engine&apos;s verification,
          weighting and citator behaviour run on whichever sources are loaded; check any citation
          you intend to rely on before relying on it.
        </p>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          {/* ── The claim under review ─────────────────────────────────── */}
          <section className="border border-outline-variant bg-surface p-6 space-y-3">
            <p className="label-micro">Claim under review</p>
            <p className="font-serif text-xl leading-snug text-on-surface">{CLAIM}</p>
            <div className="hairline-t pt-3 space-y-1">
              <p className="label-micro">Rule applied</p>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {EXCUSE_RULE.statement}
              </p>
            </div>
          </section>

          {/* ── Elements ───────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-end justify-between border-b border-outline-variant pb-2">
              <h2 className="font-serif text-2xl text-on-surface">Elements</h2>
              <p className="label-micro">Click a finding to change it</p>
            </div>

            <div className="border border-outline-variant divide-y divide-outline-variant">
              {EXCUSE_RULE.elements.map((element) => {
                const result = results.find((r) => r.elementId === element.id)
                const finding = result?.finding ?? 'not-addressed'
                return (
                  <div key={element.id} className="p-5 bg-surface flex flex-col md:flex-row gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="cell-index">{element.required ? 'REQ' : 'OPT'}</span>
                        <p className="font-serif text-lg text-on-surface leading-tight">
                          {element.label}
                        </p>
                      </div>
                      {result?.note && (
                        <p className="text-[13px] text-on-surface-variant mt-1.5 leading-snug">
                          {result.note}
                        </p>
                      )}
                      <p className="citation mt-2">
                        {result?.anchors.length ?? 0} anchor
                        {(result?.anchors.length ?? 0) === 1 ? '' : 's'} ·{' '}
                        {element.authorityIds.join(', ')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => cycleFinding(element.id)}
                      className={`self-start shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80 ${FINDING_STYLE[finding]}`}
                    >
                      {finding.replace('-', ' ')}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── Authorities ────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-end justify-between border-b border-outline-variant pb-2">
              <h2 className="font-serif text-2xl text-on-surface">Authorities in scope</h2>
              <p className="label-micro">Ranked by computed weight</p>
            </div>

            <div className="border border-outline-variant divide-y divide-outline-variant">
              {ranked.map((authority) => {
                const weight = effectiveWeight(authority)
                const verification = verificationOf(authority)
                const anchor = authority.anchors[0]
                const freshness = freshnessOf(authority)
                const provider = providerById(authority.provider)

                return (
                  <div key={authority.id} className="p-5 bg-surface space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-primary text-on-primary">
                        {TIER_LABEL[authority.tier]}
                      </span>
                      <button
                        type="button"
                        onClick={() => cycleStatus(authority.id)}
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 transition-opacity hover:opacity-80 ${STATUS_STYLE[authority.status]}`}
                        title="Cycle citator status"
                      >
                        {authority.status.replace('-', ' ')}
                      </button>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                          verification === 'verified'
                            ? 'bg-verdict-green-soft text-verdict-green'
                            : verification === 'unverified'
                              ? 'bg-verdict-yellow-soft text-verdict-yellow'
                              : 'bg-error-container text-on-error-container'
                        }`}
                      >
                        {verification}
                      </span>
                      <span className="ml-auto citation">
                        weight {weight}/100
                      </span>
                    </div>

                    <div className="h-1 bg-surface-container-high" aria-hidden="true">
                      <div className="h-full bg-primary" style={{ width: `${weight}%` }} />
                    </div>

                    <p className="font-serif text-lg text-on-surface leading-snug">
                      {authority.title}
                    </p>
                    <p className="citation">{authority.citation}</p>
                    <p className="citation">
                      {provider?.name ?? authority.provider} · as of {authority.asOf}
                      {freshness === 'stale' && ' · re-verify against the official source'}
                      {freshness === 'aging' && ' · due for re-verification'}
                    </p>

                    {anchor ? (
                      <blockquote className="border-l-2 border-accent pl-3 mt-2">
                        <p className="text-[13px] italic text-on-surface-variant leading-snug">
                          “{anchor.quote}”
                        </p>
                        <p className="citation mt-1">
                          {anchor.locator} · chars {anchor.start}–{anchor.end}
                        </p>
                      </blockquote>
                    ) : (
                      <p className="text-[13px] text-error mt-2 leading-snug">
                        Quote not found verbatim in the stored source — the anchor could not be
                        resolved, so this authority cannot support a finding.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        {/* ── Verdict rail ───────────────────────────────────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-6">
          <div className="border border-outline-variant bg-surface">
            <div className={`px-5 py-4 ${VERDICT_STYLE[summary.verdict]}`}>
              <p className="label-micro opacity-80">Triage</p>
              <p className="font-serif text-3xl mt-1 leading-none">
                {summary.verdict.toUpperCase()}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="label-micro">Disposition</p>
                <p className="font-serif text-xl text-on-surface mt-1">
                  {DISPOSITION_LABEL[mapping.disposition]}
                </p>
              </div>

              <div>
                <p className="label-micro">Confidence</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="font-serif text-2xl text-on-surface">
                    {summary.meanConfidence}
                  </span>
                  <div className="h-1 flex-1 bg-surface-container-high">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${summary.meanConfidence}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="hairline-t pt-3 space-y-1.5">
                <p className="label-micro">Why</p>
                <ul className="space-y-1.5">
                  {summary.reasons.map((reason) => (
                    <li key={reason} className="text-[13px] text-on-surface-variant leading-snug">
                      — {reason}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="hairline-t pt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ['established', summary.established],
                    ['contested', summary.contested],
                    ['unsupported', summary.unsupported],
                    ['declined', summary.declined],
                  ] as const
                ).map(([label, count]) => (
                  <div key={label} className="border border-outline-variant px-2.5 py-2">
                    <p className="font-serif text-lg text-on-surface leading-none">{count}</p>
                    <p className="label-micro mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border border-outline-variant bg-surface-container-low p-5 space-y-2">
            <p className="label-micro">Reading the rail</p>
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              RED is reserved for what a lawyer must see: an unsatisfied required element, a
              contrary binding authority, or a conclusion resting on authority that is no longer
              good law. YELLOW means a human should read it. GREEN means no exception taken.
            </p>
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              Mark the MSA clause <em>superseded</em> and the verdict falls to RED — the
              agreement governs before the statute does.
            </p>
          </div>
        </aside>
      </div>

      <KnowledgeBase />
    </div>
  )
}
