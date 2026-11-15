/**
 * practiceAreas.ts — the plugin taxonomy, and the artifacts each one opens.
 *
 * Two notes on why this is data rather than JSX.
 *
 * The twelve areas are the app's *index*: every route, triage badge, and playbook belongs
 * to exactly one of them. Keeping the list in one typed module means a new area cannot be
 * half-added across four components, and the grid page, the sidebar, and the routing table
 * all read the same source of truth.
 *
 * The twelfth cell is deliberately unnamed. The published lineup ships eleven named areas
 * and one reserved slot, so the interface says so rather than inventing a twelfth area to
 * make the grid look finished.
 */

/** The artifact modes shipped with the legal gallery. */
export type ArtifactMode =
  | 'cite-check'
  | 'jurisdiction-matrix'
  | 'matter-board'
  | 'playbook-deviation'
  | 'horizon-scan'
  | 'tabular-review'

export interface Artifact {
  id: ArtifactMode
  name: string
  /** What the artifact does, in the imperative the gallery uses. */
  verb: string
  blurb: string
  /** Route inside this app that renders it. */
  route: string
}

export const ARTIFACTS: Artifact[] = [
  {
    id: 'cite-check',
    name: 'Cite check',
    verb: 'Compare a document against its sources',
    blurb:
      'Flags quotes that do not match, wrong page numbers, and sources that do not support the claim they are cited for.',
    route: '/reviews?mode=cite-check',
  },
  {
    id: 'playbook-deviation',
    name: 'Playbook deviation board',
    verb: 'Compare contracts against your standard terms',
    blurb:
      'Flags each clause that differs, records which rung of the fallback ladder it sits on, and routes it to whoever approves that exception.',
    route: '/reviews?mode=playbook-deviation',
  },
  {
    id: 'tabular-review',
    name: 'Tabular review',
    verb: 'Build a table from a set of contracts',
    blurb:
      'Shows the terms you ask about — severance, non-competes, governing law — with a link to the exact language.',
    route: '/reviews?mode=tabular-review',
  },
  {
    id: 'jurisdiction-matrix',
    name: 'Jurisdiction survey matrix',
    verb: 'Compare one topic across states or countries',
    blurb:
      'Puts a rule such as breach-notice timing side by side across jurisdictions, with links to the underlying law.',
    route: '/reviews?mode=jurisdiction-matrix',
  },
  {
    id: 'horizon-scan',
    name: 'Regulatory horizon scan',
    verb: 'Map upcoming regulation onto a timeline',
    blurb:
      'Ranks pending rules by impact on the business and where it operates, with the source for each date.',
    route: '/reviews?mode=horizon-scan',
  },
  {
    id: 'matter-board',
    name: 'Matter board',
    verb: 'Turn engagement letters and emails into one board',
    blurb: 'Shows the owner, the next step, and the next deadline for every open matter.',
    route: '/reviews?mode=matter-board',
  },
]

export function artifactById(id: ArtifactMode): Artifact | undefined {
  return ARTIFACTS.find((a) => a.id === id)
}

/** A single namespaced skill, addressed as `namespace:command` as the plugins are. */
export interface PluginSkill {
  command: string
  label: string
  what: string
  artifact?: ArtifactMode
  /** Overrides the area's route when one skill has its own screen. */
  route?: string
}

export interface PracticeArea {
  /** Display index, '01'–'12'. Strings so the leading zero survives. */
  index: string
  id: string
  name: string
  /** Command namespace, e.g. 'commercial-legal'. */
  namespace: string
  blurb: string
  /** Rendered as the filled cell, as the gallery does. */
  featured?: boolean
  /** An area with no shipped skills is awaiting the lineup. */
  pending?: boolean
  /** Where the area lives in this app, when it maps onto existing screens. */
  route?: string
  skills: PluginSkill[]
}

export const PRACTICE_AREAS: PracticeArea[] = [
  {
    index: '01',
    id: 'commercial',
    name: 'Commercial',
    namespace: 'commercial-legal',
    blurb: 'Contracts, terms, vendor & channel paper.',
    skills: [
      { command: 'review', label: 'Contract review', what: 'Clause-by-clause review of an MSA, NDA, or SaaS agreement against the playbook.', artifact: 'playbook-deviation' },
      { command: 'renewal-tracker', label: 'Renewal tracker', what: 'Renewal and notice deadlines across the active agreement set.' },
      { command: 'escalation-flagger', label: 'Escalation flagger', what: 'Routes each flagged issue to the approver who owns that exception.' },
      { command: 'terms-compare', label: 'Terms comparison', what: 'Builds a term table across a stack of agreements.', artifact: 'tabular-review' },
    ],
  },
  {
    index: '02',
    id: 'corporate',
    name: 'Corporate',
    namespace: 'corporate-legal',
    blurb: 'Entity work, governance, M&A support.',
    skills: [
      { command: 'diligence-request', label: 'Diligence request list', what: 'Builds a request list from the deal type and the target’s structure.' },
      { command: 'board-minutes', label: 'Board minutes', what: 'Drafts minutes from an agenda and the resolutions actually passed.' },
      { command: 'amendment-history', label: 'Amendment history', what: 'Traces every amendment to the governing document and what each one changed.' },
    ],
  },
  {
    index: '03',
    id: 'employment',
    name: 'Employment',
    namespace: 'employment-legal',
    blurb: 'Policy, investigations, separation paper.',
    skills: [
      { command: 'investigation-plan', label: 'Investigation plan', what: 'Structures an internal investigation: scope, witnesses, document holds.' },
      { command: 'separation-package', label: 'Separation package', what: 'Assembles the release, the notice, and the final-pay checklist for the jurisdiction.' },
      { command: 'policy-gap', label: 'Policy gap check', what: 'Reads the handbook against current state and local requirements.' },
    ],
  },
  {
    index: '04',
    id: 'privacy',
    name: 'Privacy',
    namespace: 'privacy-legal',
    blurb: 'DPIAs, notices, data-subject requests.',
    skills: [
      { command: 'dsar-response', label: 'DSAR response', what: 'Drafts the response to a data-subject access request with the statutory clock attached.' },
      { command: 'dpa-review', label: 'DPA review', what: 'Reviews a data processing agreement against the team’s standards.', artifact: 'playbook-deviation' },
      { command: 'dpia', label: 'Impact assessment', what: 'Structures a DPIA: necessity, proportionality, and the residual risk.' },
      { command: 'notice-draft', label: 'Notice drafting', what: 'Drafts and revises the privacy notice for a new processing activity.' },
    ],
  },
  {
    index: '05',
    id: 'product',
    name: 'Product',
    namespace: 'product-legal',
    blurb: 'Counsel for shipping teams & launches.',
    skills: [
      { command: 'launch-review', label: 'Launch review', what: 'Walks a launch checklist: claims, data flows, licensing, and the go/no-go.' },
      { command: 'claims-substantiation', label: 'Claims substantiation', what: 'Tests each marketing claim against the evidence actually held.' },
      { command: 'tos-delta', label: 'Terms of service delta', what: 'Explains what changed in the terms and who is affected.' },
    ],
  },
  {
    index: '06',
    id: 'regulatory',
    name: 'Regulatory',
    namespace: 'regulatory-legal',
    blurb: 'Rule tracking, comments, compliance memos.',
    skills: [
      { command: 'horizon-scan', label: 'Horizon scan', what: 'Maps pending rules onto a timeline and ranks them by impact.', artifact: 'horizon-scan' },
      { command: 'comment-draft', label: 'Comment drafting', what: 'Drafts a rulemaking comment on the proposal as published.' },
      { command: 'compliance-memo', label: 'Compliance memo', what: 'Turns a new rule into an obligations memo with owners and dates.' },
    ],
  },
  {
    index: '07',
    id: 'ai-governance',
    name: 'AI Governance',
    namespace: 'ai-governance',
    blurb: 'Triage, AI impact assessments, vendor review, regulation-to-policy gaps.',
    featured: true,
    skills: [
      { command: 'triage', label: 'Use-case triage', what: 'Sorts a proposed AI use into the review track it belongs on.' },
      { command: 'aia', label: 'AI impact assessment', what: 'Structures the assessment: purpose, affected people, oversight, redress.' },
      { command: 'vendor-review', label: 'Model vendor review', what: 'Reviews a model or agent vendor against the governance standard.' },
      { command: 'regulation-to-policy', label: 'Regulation → policy gaps', what: 'Traces each obligation in the applicable AI rules to the policy clause that answers it.' },
    ],
  },
  {
    index: '08',
    id: 'ip',
    name: 'IP',
    namespace: 'ip-legal',
    blurb: 'Prosecution support, freedom-to-operate.',
    skills: [
      { command: 'fto', label: 'Freedom to operate', what: 'Builds a freedom-to-operate picture from the claim charts and the art.' },
      { command: 'office-action', label: 'Office action response', what: 'Drafts a response to a rejection with the claim amendments it needs.' },
      { command: 'oss-review', label: 'Open-source review', what: 'Reads the dependency licences and flags the obligations they carry.' },
    ],
  },
  {
    index: '09',
    id: 'litigation',
    name: 'Litigation',
    namespace: 'litigation-legal',
    blurb: 'Depo prep, chronologies, brief drafting.',
    featured: true,
    skills: [
      { command: 'chronology', label: 'Chronology', what: 'Builds a dated timeline from the document set, each entry anchored to its source.' },
      { command: 'depo-prep', label: 'Deposition prep', what: 'Assembles the outline: topics, exhibits, and the admissions to secure.' },
      { command: 'cite-check', label: 'Cite check', what: 'Tests every citation in a draft brief against its source.', artifact: 'cite-check' },
      { command: 'brief-draft', label: 'Brief drafting', what: 'Drafts a section against the record and the authorities that carry it.' },
      { command: 'matter-board', label: 'Matter board', what: 'Collapses the matter’s filings into owners, next steps, and deadlines.', artifact: 'matter-board' },
    ],
  },
  {
    index: '10',
    id: 'law-students',
    name: 'Law Students',
    namespace: 'law-students',
    blurb: 'Casebook study, outlining, exam practice.',
    route: '/outline',
    skills: [
      { command: 'outline', label: 'Outline builder', what: 'Four-tier doctrinal outline from a topic, a case, or your notes.' },
      { command: 'case-brief', label: 'Case brief', what: 'Citation, facts, issue, holding, and the rule of law.' },
      { command: 'irac-grade', label: 'IRAC grader', what: 'Scores each element against the rubric and names the counterargument missed.' },
      { command: 'socratic', label: 'Socratic drill', what: 'Fact pattern, one question, then the full analysis — never the answer first.' },
    ],
  },
  {
    index: '11',
    id: 'legal-clinics',
    name: 'Legal Clinics',
    namespace: 'clinics-legal',
    blurb: 'Intake, pro bono workflows, case mgmt.',
    skills: [
      { command: 'intake', label: 'Client intake', what: 'Structures intake: eligibility, conflicts, and the deadline calendar.' },
      { command: 'simplify', label: 'Plain-language restatement', what: 'Restates a document in plain language, translates it, and reads it aloud. Ported from Legal Eagle.', route: '/simplify' },
      { command: 'pro-bono-router', label: 'Pro bono routing', what: 'Matches an intake to the volunteer who can take it.' },
      { command: 'case-mgmt', label: 'Clinic case file', what: 'Keeps the clinic file current: status, next step, and who owns it.' },
    ],
  },
  {
    index: '12',
    id: 'more',
    name: '+ One more',
    namespace: 'reserved',
    blurb: 'Rounding out the launch lineup.',
    pending: true,
    skills: [],
  },
]

export function practiceAreaById(id: string): PracticeArea | undefined {
  return PRACTICE_AREAS.find((a) => a.id === id)
}

/** Resolve `namespace:command` to its skill. */
export function skillByCommand(command: string): { area: PracticeArea; skill: PluginSkill } | undefined {
  const [namespace, name] = command.split(':')
  const area = PRACTICE_AREAS.find((a) => a.namespace === namespace)
  const skill = area?.skills.find((s) => s.command === name)
  return area && skill ? { area, skill } : undefined
}

/** Every area that ships at least one skill — the denominator for "X of 11 live". */
export const LIVE_AREAS = PRACTICE_AREAS.filter((a) => a.skills.length > 0)
