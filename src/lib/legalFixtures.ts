/**
 * legalFixtures.ts — the worked example the mapping screens run on.
 *
 * Two decisions worth stating, because they are what make the screens evidence rather than
 * decoration.
 *
 * 1. THE QUOTES ARE RESOLVED, NOT TYPED. Every authority carries a `quote`, and the anchor is
 *    produced by `anchorQuote()` searching the source text for it. If a quote is edited so it
 *    no longer appears verbatim, the authority stops being 'verified' on the next render. A
 *    fixture that hardcodes offsets would drift from its own text the first time anyone
 *    touched it, and would still claim to be anchored.
 *
 * 2. THE SCENARIO IS A REAL ARGUMENT, NOT LOOKUP TABLE FILLER. Force majeure as an excuse for
 *    non-payment: three required elements, one binding authority that is itself questioned,
 *    and a contract clause that governs first. It is chosen because the correct answer changes
 *    when one authority's citator status changes — which is the point the screen has to make.
 */

import { anchorQuote } from './legalLogic'
import type {
  Anchor,
  Authority,
  AuthorityTier,
  CitatorStatus,
  ClauseFinding,
  ElementResult,
  PlaybookPosition,
  ProviderId,
  Rule,
} from './legalLogic'

export interface SourceDoc {
  id: string
  label: string
  /** Stored text. Anchors index into this string, exactly as a real corpus would. */
  text: string
}

export const SOURCE_DOCS: SourceDoc[] = [
  {
    id: 'msa-11.4',
    label: 'Vendor MSA § 11.4 — Force Majeure',
    text:
      '11.4 Force Majeure. Neither party shall be liable for delay or failure to perform ' +
      'caused by events beyond its reasonable control, including acts of God, war, civil ' +
      'unrest, epidemic, and governmental action, provided that the affected party gives ' +
      'written notice within ten (10) days and uses commercially reasonable efforts to ' +
      'mitigate. A failure to pay amounts due is not excused under this Section 11.4.',
  },
  {
    id: 'ucc-2-615',
    label: 'U.C.C. § 2-615 — Excuse by Failure of Presupposed Conditions',
    text:
      'Delay in delivery or non-delivery by a seller is not a breach of his duty under a ' +
      'contract for sale if performance as agreed has been made impracticable by the ' +
      'occurrence of a contingency the non-occurrence of which was a basic assumption on ' +
      'which the contract was made.',
  },
  {
    id: 'fla-672.615',
    label: 'Fla. Stat. § 672.615 — Excuse by failure of presupposed conditions',
    text:
      'Except so far as a seller may have assumed a greater obligation, delay in delivery or ' +
      'nondelivery is not a breach of duty under a contract for sale if performance as agreed ' +
      'has been made impracticable by the occurrence of a contingency the nonoccurrence of ' +
      'which was a basic assumption on which the contract was made.',
  },
  {
    id: 'transatlantic',
    label: 'Transatlantic Financing Corp. v. United States',
    text:
      'The doctrine of commercial impracticability does not apply where the unforeseen event ' +
      'merely increases the cost of performance. A mere increase in expense, even a ' +
      'substantial one, is not enough; the performance must be positively prevented.',
  },
  {
    id: 'eastern-air',
    label: 'Eastern Air Lines, Inc. v. Gulf Oil Corp.',
    text:
      'Where the parties have expressly allocated the risk of supply disruption in their ' +
      'agreement, the court will enforce that allocation rather than supply a term excusing ' +
      'performance. The parties are the best judges of the risks they wish to bear.',
  },
  {
    id: 'lloyd',
    label: 'Lloyd v. Murphy',
    text:
      'Frustration of purpose requires that the value of counter-performance be totally or ' +
      'nearly totally destroyed. It is not enough that the transaction has become less ' +
      'profitable than expected.',
  },
]

interface AuthoritySeed {
  id: string
  citation: string
  title: string
  tier: AuthorityTier
  jurisdiction: string
  year?: number
  status: CitatorStatus
  sourceId: string
  locator: string
  /** Must appear verbatim in the source text, or the anchor fails to resolve. */
  quote: string
  read: boolean
}

export const AUTHORITY_SEEDS: AuthoritySeed[] = [
  {
    id: 'msa-11.4',
    citation: 'Vendor MSA § 11.4',
    title: 'Force Majeure',
    tier: 'practice-document',
    jurisdiction: 'Agreement',
    status: 'good-law',
    sourceId: 'msa-11.4',
    locator: '§ 11.4',
    quote: 'A failure to pay amounts due is not excused under this Section 11.4.',
    read: true,
  },
  {
    id: 'fla-672.615',
    citation: 'Fla. Stat. § 672.615',
    title: 'Excuse by failure of presupposed conditions',
    tier: 'statute',
    jurisdiction: 'Florida',
    year: 2025,
    status: 'good-law',
    sourceId: 'fla-672.615',
    locator: '§ 672.615',
    quote: 'performance as agreed has been made impracticable by the occurrence of a contingency',
    read: true,
  },
  {
    id: 'ucc-2-615',
    citation: 'U.C.C. § 2-615',
    title: 'Excuse by Failure of Presupposed Conditions',
    tier: 'statute',
    jurisdiction: 'Model',
    year: 1977,
    status: 'good-law',
    sourceId: 'ucc-2-615',
    locator: '§ 2-615',
    quote: 'performance as agreed has been made impracticable by the occurrence of a contingency',
    read: true,
  },
  {
    id: 'eastern-air',
    citation: 'E. Air Lines, Inc. v. Gulf Oil Corp., 415 F. Supp. 429 (S.D. Fla. 1975)',
    title: 'Express risk allocation displaces the excuse',
    tier: 'case-binding',
    jurisdiction: 'S.D. Fla.',
    year: 1975,
    status: 'questioned',
    sourceId: 'eastern-air',
    locator: 'at 432',
    quote: 'the court will enforce that allocation rather than supply a term excusing performance',
    read: true,
  },
  {
    id: 'transatlantic',
    citation: 'Transatlantic Financing Corp. v. United States, 363 F.2d 312 (D.C. Cir. 1966)',
    title: 'Increased cost is not impracticability',
    tier: 'case-persuasive',
    jurisdiction: 'D.C. Cir.',
    year: 1966,
    status: 'good-law',
    sourceId: 'transatlantic',
    locator: 'at 319',
    quote: 'A mere increase in expense, even a substantial one, is not enough',
    read: true,
  },
  {
    id: 'lloyd',
    citation: 'Lloyd v. Murphy, 25 Cal. 2d 48 (1944)',
    title: 'Frustration of purpose threshold',
    tier: 'case-persuasive',
    jurisdiction: 'California',
    year: 1944,
    status: 'good-law',
    sourceId: 'lloyd',
    locator: 'at 54',
    quote: 'the value of counter-performance be totally or nearly totally destroyed',
    read: true,
  },
]

/**
 * Provenance, kept in one map rather than repeated on six seeds.
 *
 * The Florida section carries the oldest date on purpose: a primary source pulled in February
 * is exactly what `freshnessOf()` exists to surface, and it should read as a different kind of
 * risk from a 1975 opinion — which is old and still good law, not stale.
 */
const PROVENANCE: Record<string, { provider: ProviderId; asOf: string }> = {
  'msa-11.4': { provider: 'agreement', asOf: '2026-10-01' },
  'fla-672.615': { provider: 'flstatutes', asOf: '2026-02-10' },
  'ucc-2-615': { provider: 'manual', asOf: '2026-03-01' },
  transatlantic: { provider: 'courtlistener', asOf: '2026-10-20' },
  'eastern-air': { provider: 'courtlistener', asOf: '2026-10-20' },
  lloyd: { provider: 'courtlistener', asOf: '2026-10-20' },
}

/**
 * Resolve every seed into an `Authority` with a computed anchor.
 *
 * A quote that does not resolve still yields an authority — but with no anchor, which
 * `verificationOf()` reports as 'unverified'. Dropping it instead would hide the failure.
 */
export function seedAuthorities(): Authority[] {
  return AUTHORITY_SEEDS.map((seed) => {
    const doc = SOURCE_DOCS.find((d) => d.id === seed.sourceId)
    const anchor: Anchor | null = doc
      ? anchorQuote(seed.sourceId, doc.text, seed.quote, seed.locator)
      : null
    const provenance =
      PROVENANCE[seed.sourceId] ?? { provider: 'manual' as ProviderId, asOf: '2026-01-01' }

    return {
      id: seed.id,
      citation: seed.citation,
      title: seed.title,
      tier: seed.tier,
      jurisdiction: seed.jurisdiction,
      year: seed.year,
      status: seed.status,
      read: seed.read,
      anchors: anchor ? [anchor] : [],
      provider: provenance.provider,
      asOf: provenance.asOf,
    }
  })
}

/** The doctrine under test, expressed as required elements. */
export const EXCUSE_RULE: Rule = {
  id: 'excuse-nonperformance',
  statement:
    'Non-payment is excused where performance has been made impracticable by an unforeseen ' +
    'contingency whose non-occurrence was a basic assumption of the agreement.',
  // The clause is listed first on purpose: it governs before the statute does, so marking it
  // superseded must be able to defeat a conclusion the statute alone would support.
  authorityIds: ['msa-11.4', 'fla-672.615', 'ucc-2-615'],
  elements: [
    {
      id: 'contingency',
      label: 'A contingency occurred',
      required: true,
      authorityIds: ['fla-672.615', 'ucc-2-615'],
    },
    {
      id: 'unforeseen',
      label: 'Its non-occurrence was a basic assumption',
      required: true,
      authorityIds: ['transatlantic', 'lloyd'],
    },
    {
      id: 'impeded',
      label: 'Performance was prevented, not merely costlier',
      required: true,
      authorityIds: ['transatlantic'],
    },
  ],
}

/** Findings for the element under examination — the payment obligation. */
export function seedElementResults(): ElementResult[] {
  // Build the authority set once; resolving six anchors three times over would be wasteful
  // and, worse, would let the three element lists disagree if the resolver ever changed.
  const anchorsOf = (id: string) =>
    seedAuthorities().find((a) => a.id === id)?.anchors ?? []

  return [
    {
      elementId: 'contingency',
      finding: 'satisfied',
      anchors: anchorsOf('fla-672.615'),
      note: 'Statute supplies the test; no finding of fact yet.',
    },
    {
      elementId: 'unforeseen',
      finding: 'unclear',
      anchors: anchorsOf('lloyd'),
      note: 'Counterparty asserts the supply disruption was foreseeable at signing.',
    },
    {
      elementId: 'impeded',
      finding: 'not-satisfied',
      anchors: anchorsOf('transatlantic'),
      note: 'Price rose 38%. On Transatlantic that is increased cost, not prevention.',
    },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Playbook
// ─────────────────────────────────────────────────────────────────────────────

export const PLAYBOOK: PlaybookPosition[] = [
  {
    clauseId: 'limitation-liability',
    clauseName: 'Limitation of liability',
    standard: 'Cap at 12 months of fees, mutual, excluding confidentiality and IP indemnity.',
    walkAway: 'Uncapped liability, or a cap above 24 months of fees.',
    fallbacks: [
      {
        id: 'cap-18',
        text: 'Cap raised to 18 months of fees for the vendor side only.',
        approver: 'Head of Commercial',
        severity: 'material' as const,
      },
      {
        id: 'cap-24-supercap',
        text: '24-month cap with a super-cap for data breach.',
        approver: 'General Counsel',
        severity: 'critical' as const,
      },
    ],
  },
  {
    clauseId: 'indemnity',
    clauseName: 'IP indemnity',
    standard: 'Vendor indemnifies for third-party IP claims, with defend-and-hold-harmless.',
    walkAway: 'No indemnity, or indemnity limited to the fee paid.',
    fallbacks: [
      {
        id: 'indem-shared',
        text: 'Shared defence costs, vendor pays 50% up to the liability cap.',
        approver: 'Reviewing counsel',
        severity: 'material' as const,
      },
    ],
  },
  {
    clauseId: 'termination',
    clauseName: 'Termination for convenience',
    standard: 'Customer may terminate for convenience on 30 days notice, no penalty.',
    walkAway: 'No termination right before the initial term ends.',
    fallbacks: [
      {
        id: 'term-60',
        text: 'Termination for convenience on 60 days notice with a wind-down fee.',
        approver: 'Head of Commercial',
        severity: 'minor' as const,
      },
    ],
  },
]

/** A finding, paired with the clause it was made about and the document it was read from. */
export interface PlaybookFinding extends ClauseFinding {
  clauseId: string
  sourceId?: string
}

export const PLAYBOOK_FINDINGS: PlaybookFinding[] = [
  {
    clauseId: 'limitation-liability',
    match: 'fallback' as const,
    confidence: 88,
    fallbackId: 'cap-18',
    observed: 'Aggregate liability shall not exceed fees paid in the preceding eighteen months.',
    sourceId: 'msa-11.4',
  },
  {
    clauseId: 'indemnity',
    match: 'standard' as const,
    confidence: 54,
    observed: 'Vendor shall defend and indemnify Customer against third-party IP claims.',
    sourceId: 'msa-11.4',
  },
  {
    clauseId: 'termination',
    match: 'missing' as const,
    confidence: 92,
    sourceId: 'msa-11.4',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Tabular review, jurisdiction matrix, horizon scan, matters
// ─────────────────────────────────────────────────────────────────────────────

export const TABULAR_TERMS = [
  'Governing law',
  'Liability cap',
  'Non-compete',
  'Renewal notice',
] as const

export const TABULAR_ROWS = [
  {
    contract: 'Northwind SaaS MSA',
    values: ['New York', '12 mo. fees', 'None', '60 days'],
    anchor: 'Northwind MSA art. 14',
  },
  {
    contract: 'Cobalt Data DPA',
    values: ['Ireland', '€1,000,000', 'N/A — employee terms', '30 days'],
    anchor: 'Cobalt DPA § 9.2',
  },
  {
    contract: 'Sterling Reseller Agreement',
    values: ['Florida', 'Uncapped', '24 months, statewide', '90 days'],
    anchor: 'Sterling Reseller § 7',
  },
  {
    contract: 'Harbour Logistics Terms',
    values: ['England & Wales', '2× annual fees', '12 months', 'Automatic'],
    anchor: 'Harbour Terms cl. 3.1',
  },
]

export const JURISDICTION_ROWS = [
  { jurisdiction: 'Florida', clock: '30 days', trigger: 'Discovery of the breach', source: 'Fla. Stat. § 501.171' },
  { jurisdiction: 'California', clock: 'No statutory deadline', trigger: 'Discovery, without unreasonable delay', source: 'Cal. Civ. Code § 1798.82' },
  { jurisdiction: 'New York', clock: 'No statutory deadline', trigger: 'Discovery, without unreasonable delay', source: 'N.Y. Gen. Bus. Law § 899-aa' },
  { jurisdiction: 'GDPR', clock: '72 hours', trigger: 'Becoming aware of the breach', source: 'GDPR art. 33(1)' },
]

export const HORIZON_ITEMS = [
  {
    // AI Act art. 113: transparency obligations apply from 2 August 2026.
    date: '2026-08-02',
    title: 'AI Act — transparency obligations apply',
    impact: 'high' as const,
    source: 'Regulation (EU) 2024/1689 art. 50',
    owner: 'AI Governance',
  },
  {
    date: '2027-01-15',
    title: 'State privacy rulemaking — comment period closes',
    impact: 'medium' as const,
    source: 'Proposed rule, 91 Fed. Reg. 4412',
    owner: 'Privacy',
  },
  {
    date: '2027-03-31',
    title: 'DPA re-papering deadline for legacy vendors',
    impact: 'medium' as const,
    source: 'Internal policy P-114',
    owner: 'Commercial',
  },
  {
    date: '2027-08-02',
    title: 'AI Act — high-risk obligations apply',
    impact: 'high' as const,
    source: 'Regulation (EU) 2024/1689 art. 6',
    owner: 'AI Governance',
  },
]

export const MATTERS = [
  {
    matter: 'Northwind renewal',
    owner: 'Commercial',
    nextStep: 'Send redline with revised cap',
    deadline: '2026-11-14',
    status: 'green' as const,
  },
  {
    matter: 'Sterling reseller dispute',
    owner: 'Litigation',
    nextStep: 'Chronology from the 2024 correspondence',
    deadline: '2026-11-07',
    status: 'red' as const,
  },
  {
    matter: 'EU AI Act gap assessment',
    owner: 'AI Governance',
    nextStep: 'Map obligations to policy clauses',
    deadline: '2026-11-21',
    status: 'yellow' as const,
  },
]
