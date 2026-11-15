import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ARTIFACTS } from '../lib/practiceAreas'
import type { ArtifactMode } from '../lib/practiceAreas'
import { anchorQuote, escalationLine, evaluateClause } from '../lib/legalLogic'
import type { Deviation, Triage } from '../lib/legalLogic'
import {
  HORIZON_ITEMS,
  JURISDICTION_ROWS,
  MATTERS,
  PLAYBOOK,
  PLAYBOOK_FINDINGS,
  SOURCE_DOCS,
  TABULAR_ROWS,
  TABULAR_TERMS,
} from '../lib/legalFixtures'

/**
 * Reviews — the artifact gallery.
 *
 * One route, six modes, chosen by `?mode=`. The reason is not economy: the gallery ships these
 * as variations on a single idea — put a document next to the standard it should meet, then
 * show every point of difference with a link to the language that caused it. Rendering them as
 * six unrelated pages would hide that they are one workflow.
 *
 * The deviation board is the one that carries the routing logic, so it is the one that runs
 * through `evaluateClause()` rather than reading a pre-computed verdict.
 */

const MODE_LABEL: Record<ArtifactMode, string> = {
  'cite-check': 'Cite check',
  'playbook-deviation': 'Deviations',
  'tabular-review': 'Tabular',
  'jurisdiction-matrix': 'Jurisdictions',
  'horizon-scan': 'Horizon',
  'matter-board': 'Matters',
}

const VERDICT_BG: Record<Triage, string> = {
  green: 'bg-verdict-green-soft text-verdict-green',
  yellow: 'bg-verdict-yellow-soft text-verdict-yellow',
  red: 'bg-verdict-red-soft text-verdict-red',
}

const IMPACT_STYLE: Record<'high' | 'medium', string> = {
  high: 'bg-verdict-red-soft text-verdict-red',
  medium: 'bg-verdict-yellow-soft text-verdict-yellow',
}

/** Cite-check fixture: one good quote, one that was altered, one that does not carry the claim. */
const CITE_ROWS = [
  {
    claim: 'A mere increase in cost does not excuse performance.',
    sourceId: 'transatlantic',
    quote: 'A mere increase in expense, even a substantial one, is not enough',
    expect: 'verified' as const,
  },
  {
    claim: 'A material increase in cost does not excuse performance.',
    sourceId: 'transatlantic',
    quote: 'A material increase in expense is not enough',
    expect: 'mismatch' as const,
  },
  {
    claim: 'The clause excuses non-payment where notice is late.',
    sourceId: 'msa-11.4',
    quote: 'A failure to pay amounts due is not excused under this Section 11.4.',
    expect: 'no-support' as const,
  },
]

function modeFromParam(value: string | null): ArtifactMode {
  const found = ARTIFACTS.find((a) => a.id === value)
  return found ? found.id : 'playbook-deviation'
}

export function Reviews() {
  const [params, setParams] = useSearchParams()
  const mode = modeFromParam(params.get('mode'))

  const deviations = useMemo<Deviation[]>(
    () =>
      PLAYBOOK_FINDINGS.map((finding) => {
        const position = PLAYBOOK.find((p) => p.clauseId === finding.clauseId)
        return position
          ? evaluateClause(position, finding)
          : {
              clauseId: finding.clauseId,
              clauseName: finding.clauseId,
              match: finding.match,
              verdict: 'yellow' as Triage,
              severity: 'material' as const,
              approver: 'Reviewing counsel',
              rationale: 'No playbook position is configured for this clause.',
            }
      }),
    [],
  )

  const counts = useMemo(
    () => ({
      green: deviations.filter((d) => d.verdict === 'green').length,
      yellow: deviations.filter((d) => d.verdict === 'yellow').length,
      red: deviations.filter((d) => d.verdict === 'red').length,
    }),
    [deviations],
  )

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-8">
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">Artifact gallery</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          Put the document next to the standard
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
          Each artifact opens with an example so the shape of the work is visible before any
          data is attached. Every difference links back to the language that caused it.
        </p>
      </header>

      {/* ── Mode switcher ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {ARTIFACTS.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => setParams({ mode: artifact.id })}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              artifact.id === mode
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {MODE_LABEL[artifact.id]}
          </button>
        ))}
      </div>

      {/* ── Cite check ───────────────────────────────────────────────────── */}
      {mode === 'cite-check' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Cite check</h2>
            <p className="label-micro">
              {CITE_ROWS.filter((r) => r.expect === 'verified').length} of {CITE_ROWS.length}{' '}
              clean
            </p>
          </div>

          <div className="border border-outline-variant divide-y divide-outline-variant">
            {CITE_ROWS.map((row) => {
              const doc = SOURCE_DOCS.find((d) => d.id === row.sourceId)
              const anchor = doc
                ? anchorQuote(row.sourceId, doc.text, row.quote, 'cited passage')
                : null
              const status =
                row.expect === 'mismatch'
                  ? 'Quote not in source'
                  : row.expect === 'no-support'
                    ? 'Source does not support the claim'
                    : 'Verified'
              const style =
                row.expect === 'verified'
                  ? 'bg-verdict-green-soft text-verdict-green'
                  : 'bg-verdict-red-soft text-verdict-red'

              return (
                <div key={row.claim} className="p-5 bg-surface space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${style}`}>
                      {status}
                    </span>
                    <span className="citation">{row.sourceId}</span>
                  </div>
                  <p className="font-serif text-lg text-on-surface leading-snug">{row.claim}</p>
                  <blockquote className="border-l-2 border-outline-variant pl-3">
                    <p className="text-[13px] italic text-on-surface-variant leading-snug">
                      “{row.quote}”
                    </p>
                  </blockquote>
                  {anchor ? (
                    <p className="citation">
                      Resolved at chars {anchor.start}–{anchor.end}
                    </p>
                  ) : (
                    <p className="citation">
                      No match in the stored text — the citation cannot be verified as written.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Playbook deviation board ─────────────────────────────────────── */}
      {mode === 'playbook-deviation' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Playbook deviation board</h2>
            <p className="label-micro">
              {counts.green} clear · {counts.yellow} to read · {counts.red} to decide
            </p>
          </div>

          <div className="border border-outline-variant divide-y divide-outline-variant">
            {deviations.map((deviation) => {
              const position = PLAYBOOK.find((p) => p.clauseId === deviation.clauseId)
              return (
                <div key={deviation.clauseId} className="p-5 bg-surface space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${VERDICT_BG[deviation.verdict]}`}
                    >
                      {deviation.verdict}
                    </span>
                    <span className="cell-index">{deviation.match}</span>
                    <span className="citation ml-auto">{escalationLine(deviation)}</span>
                  </div>

                  <p className="font-serif text-lg text-on-surface leading-snug">
                    {deviation.clauseName}
                  </p>
                  <p className="text-[13px] text-on-surface-variant leading-snug">
                    {deviation.rationale}
                  </p>

                  <div className="hairline-t pt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="label-micro">Standard position</p>
                      <p className="text-[13px] text-on-surface-variant leading-snug mt-1">
                        {position?.standard}
                      </p>
                    </div>
                    <div>
                      <p className="label-micro">Walk-away</p>
                      <p className="text-[13px] text-on-surface-variant leading-snug mt-1">
                        {position?.walkAway}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            A confident read in the safe direction is not automatically cleared: read at 54%
            confidence, the IP indemnity stays YELLOW until a human confirms it, because that is
            the case where an automated GREEN does the most damage.
          </p>
        </section>
      )}

      {/* ── Tabular review ───────────────────────────────────────────────── */}
      {mode === 'tabular-review' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Tabular review</h2>
            <p className="label-micro">{TABULAR_ROWS.length} agreements</p>
          </div>

          <div className="border border-outline-variant overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left px-4 py-3 label-micro">Agreement</th>
                  {TABULAR_TERMS.map((term) => (
                    <th key={term} className="text-left px-4 py-3 label-micro">
                      {term}
                    </th>
                  ))}
                  <th className="text-left px-4 py-3 label-micro">Source</th>
                </tr>
              </thead>
              <tbody>
                {TABULAR_ROWS.map((row, index) => (
                  <tr
                    key={row.contract}
                    className={index % 2 === 0 ? 'bg-surface' : 'bg-surface-container/40'}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">{row.contract}</td>
                    {row.values.map((value, column) => (
                      <td key={column} className="px-4 py-3 text-on-surface-variant">
                        {value}
                      </td>
                    ))}
                    <td className="px-4 py-3 citation">{row.anchor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Jurisdiction matrix ──────────────────────────────────────────── */}
      {mode === 'jurisdiction-matrix' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Breach notification</h2>
            <p className="label-micro">{JURISDICTION_ROWS.length} jurisdictions</p>
          </div>

          <div className="border border-outline-variant divide-y divide-outline-variant">
            {JURISDICTION_ROWS.map((row) => (
              <div key={row.jurisdiction} className="p-5 bg-surface grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <p className="label-micro">Jurisdiction</p>
                  <p className="font-serif text-lg text-on-surface mt-1 leading-tight">
                    {row.jurisdiction}
                  </p>
                </div>
                <div>
                  <p className="label-micro">Clock</p>
                  <p className="text-sm text-on-surface-variant mt-1">{row.clock}</p>
                </div>
                <div>
                  <p className="label-micro">Trigger</p>
                  <p className="text-sm text-on-surface-variant mt-1">{row.trigger}</p>
                </div>
                <div>
                  <p className="label-micro">Source</p>
                  <p className="citation mt-1">{row.source}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Horizon scan ─────────────────────────────────────────────────── */}
      {mode === 'horizon-scan' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Regulatory horizon</h2>
            <p className="label-micro">{HORIZON_ITEMS.length} pending</p>
          </div>

          <div className="border border-outline-variant divide-y divide-outline-variant">
            {HORIZON_ITEMS.map((item) => (
              <div key={item.title} className="p-5 bg-surface flex flex-col md:flex-row gap-4">
                <div className="w-28 shrink-0">
                  <p className="citation">{item.date}</p>
                  <span
                    className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${IMPACT_STYLE[item.impact]}`}
                  >
                    {item.impact}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-lg text-on-surface leading-snug">{item.title}</p>
                  <p className="citation mt-1">{item.source}</p>
                </div>
                <p className="label-micro shrink-0">{item.owner}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Matter board ─────────────────────────────────────────────────── */}
      {mode === 'matter-board' && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Matter board</h2>
            <p className="label-micro">{MATTERS.length} open</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
            {MATTERS.map((matter) => (
              <div key={matter.matter} className="bg-surface p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${VERDICT_BG[matter.status]}`}
                  >
                    {matter.status}
                  </span>
                  <span className="cell-index ml-auto">{matter.deadline}</span>
                </div>
                <p className="font-serif text-lg text-on-surface leading-tight">{matter.matter}</p>
                <p className="text-[13px] text-on-surface-variant leading-snug">
                  {matter.nextStep}
                </p>
                <p className="label-micro">{matter.owner}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
