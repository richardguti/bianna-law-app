/**
 * legalLogic.ts — the source-to-conclusion mapping engine.
 *
 * This is the layer the Claude for Legal plugins deliberately leave to the practitioner.
 * A plugin supplies the workflow *shape* — "review this MSA against your playbook and
 * return GREEN / YELLOW / RED" — but nothing in a markdown skill decides which authority
 * outranks which, whether a quoted passage actually supports the proposition it is cited
 * for, or what the system should do when the sources do not answer the question at all.
 *
 * Three commitments shape everything below.
 *
 * 1. WEIGHT IS COMPUTED, NOT ASSERTED. An authority's weight derives from its tier, is
 *    discounted by its citator status, and is discounted again when the source was never
 *    read. A binding case that has been overruled must rank *below* a persuasive one that
 *    still stands, or the ranking is a decoration rather than a judgment.
 *
 * 2. ANCHORS ARE CHARACTER OFFSETS, NOT PAGE NUMBERS. "See p. 4" cannot be checked
 *    mechanically and silently rots when the document is re-exported. An offset pair plus
 *    the verbatim quote can be re-verified against the stored text on every render, so a
 *    citation is either provably attached to its source or it is reported as unattached.
 *
 * 3. DECLINING IS A FIRST-CLASS OUTCOME. The most common failure of legal AI is not a
 *    wrong answer, it is a confident answer to a question the corpus never addressed.
 *    `Disposition` therefore includes 'declined', and the reasons travel with it so the
 *    interface can show *why* it stayed silent instead of implying it had nothing to say.
 *
 * Nothing here touches the network, the model, or the DOM. It is pure data in, data out,
 * which is what makes it the one part of the product that can be asserted on directly.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Authorities
// ─────────────────────────────────────────────────────────────────────────────

/** Weight of authority, highest first. Order is meaningful — see `tierRank`. */
export type AuthorityTier =
  | 'constitution'
  | 'statute'
  | 'regulation'
  | 'procedural-rule'
  | 'case-binding'
  | 'case-persuasive'
  | 'secondary'
  | 'practice-document'

/**
 * Citator status. 'unknown' is not a synonym for 'good-law' — an unchecked authority is
 * discounted, because the whole point of a citator is that silence is not reassurance.
 */
export type CitatorStatus =
  | 'good-law'
  | 'caution'
  | 'questioned'
  | 'overruled'
  | 'superseded'
  | 'unknown'

/** Whether the text behind a citation was actually available to the system. */
export type Verification = 'verified' | 'unverified' | 'missing'

/**
 * A character-anchored quotation. `start`/`end` index into the stored text of `sourceId`;
 * `quote` is the verbatim span, kept alongside so the anchor can be checked rather than
 * trusted.
 */
export interface Anchor {
  sourceId: string
  /** Human locator for display: "op. at 7", "§ 2-207(2)", "Ex. B ¶ 4.1". */
  locator: string
  start: number
  end: number
  quote: string
}

export interface Authority {
  id: string
  /** Bluebook-style citation, as it would appear in a brief. */
  citation: string
  title: string
  tier: AuthorityTier
  jurisdiction: string
  year?: number
  status: CitatorStatus
  anchors: Anchor[]
  /** True only when the underlying text is in the corpus and was read. */
  read: boolean
  /** Where the text came from. A research tool is not a source of law — see PROVIDERS. */
  provider: ProviderId
  /**
   * ISO date the provider's text was retrieved. Required, not optional: an answer about
   * current law with no as-of date is an answer about law of unknown age, and primary sources
   * change. This is the field that lets the interface say "current as of …" instead of
   * implying currency it cannot promise.
   */
  asOf: string
}

export type ProviderId =
  | 'courtlistener'
  | 'uscode'
  | 'ecfr'
  | 'flstatutes'
  | 'congress'
  | 'doctrine-library'
  | 'agreement'
  | 'manual'

export interface Provider {
  id: ProviderId
  name: string
  kind: 'case-law' | 'primary' | 'legislative' | 'library' | 'document'
  url: string
  /** Said plainly, in the interface, next to anything drawn from this provider. */
  caveat: string
}

/**
 * The provider registry.
 *
 * Split by kind on purpose. Case law retrieval answers "what have courts held", primary sources
 * answer "what does the rule say today", and a benchmark answers neither — it measures whether
 * a model can do the task at all. Collapsing those into "a legal database" is how a tool ends
 * up citing a dataset as though it were authority.
 */
export const PROVIDERS: Provider[] = [
  {
    id: 'courtlistener',
    name: 'Free Law Project · CourtListener',
    kind: 'case-law',
    url: 'https://www.courtlistener.com',
    caveat:
      'Court opinions and dockets. Coverage and currency vary by court and document type, and case law is not a statute.',
  },
  {
    id: 'uscode',
    name: 'Office of the Law Revision Counsel · U.S. Code',
    kind: 'primary',
    url: 'https://uscode.house.gov',
    caveat: 'Official text of the U.S. Code, current only to the last published supplement.',
  },
  {
    id: 'ecfr',
    name: 'eCFR · Code of Federal Regulations',
    kind: 'primary',
    url: 'https://www.ecfr.gov',
    caveat: 'Current regulation text, but not the whole of federal law and not state law.',
  },
  {
    id: 'congress',
    name: 'Congress.gov',
    kind: 'legislative',
    url: 'https://www.congress.gov',
    caveat:
      'Bills, amendments and votes. Useful for legislative history; not an authoritative statement of the current Code.',
  },
  {
    id: 'flstatutes',
    name: 'Florida Statutes · flsenate.gov',
    kind: 'primary',
    url: 'https://www.flsenate.gov/Laws/Statutes',
    caveat:
      'Snapshot text served from the bundled corpus. Verify the section against the Senate before citing it as current.',
  },
  {
    id: 'doctrine-library',
    name: 'Leviathan-Law doctrine library',
    kind: 'library',
    url: '',
    caveat: 'A local reference shelf. Secondary material: persuasive context, never authority.',
  },
  {
    id: 'agreement',
    name: 'Agreement under review',
    kind: 'document',
    url: '',
    caveat: 'The document itself. Governing, but only as far as its own four corners reach.',
  },
  {
    id: 'manual',
    name: 'Manually entered',
    kind: 'document',
    url: '',
    caveat: 'Entered by a person; not independently verified against a publisher.',
  },
]

export function providerById(id: ProviderId): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Days between an as-of date and now. Negative values mean the date is in the future. */
export function daysSince(asOf: string, today: Date = new Date()): number {
  const then = new Date(`${asOf}T00:00:00`).getTime()
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  return Math.floor((today.getTime() - then) / 86_400_000)
}

export type Freshness = 'fresh' | 'aging' | 'stale'

/**
 * How much to trust that an authority still says what it said.
 *
 * Only primary law is graded. A 1966 opinion is not "stale" — it is old and still good law,
 * which is what the citator status is for. A statute checked two years ago might have been
 * amended last month.
 */
export function freshnessOf(authority: Authority, today: Date = new Date()): Freshness {
  const primary =
    authority.tier === 'statute' ||
    authority.tier === 'regulation' ||
    authority.tier === 'procedural-rule' ||
    authority.tier === 'constitution'
  if (!primary) return 'fresh'

  const age = daysSince(authority.asOf, today)
  if (age <= 180) return 'fresh'
  if (age <= 365) return 'aging'
  return 'stale'
}

const TIER_WEIGHT: Record<AuthorityTier, number> = {
  constitution: 100,
  statute: 90,
  regulation: 80,
  'procedural-rule': 75,
  'case-binding': 70,
  'case-persuasive': 45,
  secondary: 25,
  'practice-document': 10,
}

const STATUS_FACTOR: Record<CitatorStatus, number> = {
  'good-law': 1,
  caution: 0.8,
  questioned: 0.6,
  superseded: 0.35,
  overruled: 0.1,
  unknown: 0.5,
}

/** Higher rank = stronger tier. Used for ordering, not for arithmetic. */
export function tierRank(tier: AuthorityTier): number {
  return TIER_WEIGHT[tier]
}

/**
 * The computed strength of an authority, 0–100.
 *
 * Deliberately multiplicative: a discount in any one dimension compounds rather than being
 * averaged away, so an overruled, unread case cannot be rescued by a high tier.
 */
export function effectiveWeight(authority: Authority): number {
  const tier = TIER_WEIGHT[authority.tier]
  const status = STATUS_FACTOR[authority.status]
  const read = authority.read ? 1 : 0.5
  const anchored = authority.anchors.length > 0 ? 1 : 0.7
  return Math.round(tier * status * read * anchored)
}

/**
 * Verification state, derived rather than stored so it can never drift from the anchors.
 * An authority with no anchor is 'unverified' even when it was read: having the document
 * open is not the same as having tied the proposition to a passage in it.
 */
export function verificationOf(authority: Authority): Verification {
  if (!authority.read) return 'missing'
  return authority.anchors.length > 0 ? 'verified' : 'unverified'
}

/** Strongest first; ties broken by citation text so ordering is stable across renders. */
export function rankAuthorities(authorities: Authority[]): Authority[] {
  return [...authorities].sort((a, b) => {
    const diff = effectiveWeight(b) - effectiveWeight(a)
    return diff !== 0 ? diff : a.citation.localeCompare(b.citation)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules, elements, and claim mapping
// ─────────────────────────────────────────────────────────────────────────────

export interface Element {
  id: string
  label: string
  /** A non-required element can be missing without defeating the claim. */
  required: boolean
  authorityIds: string[]
}

export interface Rule {
  id: string
  statement: string
  elements: Element[]
  authorityIds: string[]
}

export type Finding = 'satisfied' | 'not-satisfied' | 'unclear' | 'not-addressed'

export interface ElementResult {
  elementId: string
  finding: Finding
  anchors: Anchor[]
  note?: string
}

/**
 * The four outcomes a mapping can reach.
 *
 * 'declined' is the one that matters most: it is reached when no required element was
 * addressed at all, which means the corpus was silent rather than the claim being weak.
 * Conflating the two is how a legal AI ends up confidently wrong.
 */
export type Disposition = 'established' | 'contested' | 'unsupported' | 'declined'

export interface ClaimMapping {
  claim: string
  ruleId: string
  elementResults: ElementResult[]
  supporting: string[]
  contrary: string[]
  disposition: Disposition
  /** Present whenever disposition is 'declined'; shown to the user verbatim. */
  declinedReason?: string
  /** 0–100. Derived from the weakest required element and the authorities behind it. */
  confidence: number
}

/**
 * Map element findings onto a disposition.
 *
 * The order of these branches is the logic: "nothing was addressed" must be checked before
 * "something failed", because an unanswered element is not a failed one.
 */
export function mapClaim(
  claim: string,
  rule: Rule,
  results: ElementResult[],
  authorities: Authority[],
): ClaimMapping {
  const byId = new Map(authorities.map((a) => [a.id, a]))
  const required = rule.elements.filter((e) => e.required)
  const resultFor = (id: string) => results.find((r) => r.elementId === id)

  const supporting = new Set<string>()
  const contrary = new Set<string>()

  let worst = 100
  let addressed = 0

  for (const element of required) {
    const result = resultFor(element.id)
    if (!result || result.finding === 'not-addressed') continue
    addressed += 1

    const cited = result.anchors.length
      ? result.anchors.map((a) => a.sourceId)
      : element.authorityIds

    for (const id of cited) {
      if (!byId.has(id)) continue
      if (result.finding === 'satisfied') supporting.add(id)
      else contrary.add(id)
    }

    // The element's own authorities cap its strength: a satisfied element resting on an
    // overruled case is weak even though it was answered.
    const elementWeight = cited.reduce((max, id) => {
      const authority = byId.get(id)
      return authority ? Math.max(max, effectiveWeight(authority)) : max
    }, 0)

    const findingFactor =
      result.finding === 'satisfied' ? 1 : result.finding === 'unclear' ? 0.45 : 0.1

    // Anchored findings are worth more than bare assertions.
    const anchorFactor = result.anchors.length > 0 ? 1 : 0.6

    worst = Math.min(worst, Math.round(elementWeight * findingFactor * anchorFactor))
  }

  rule.authorityIds.forEach((id) => {
    if (byId.has(id)) supporting.add(id)
  })

  let disposition: Disposition
  let declinedReason: string | undefined

  if (required.length > 0 && addressed === 0) {
    disposition = 'declined'
    declinedReason =
      `No required element of "${rule.statement.slice(0, 80)}" is addressed by the ` +
      `sources in scope. The corpus is silent on this question — not adverse to it.`
  } else if (required.some((e) => resultFor(e.id)?.finding === 'not-satisfied')) {
    disposition = 'unsupported'
  } else if (required.some((e) => resultFor(e.id)?.finding === 'unclear')) {
    disposition = 'contested'
  } else if (required.every((e) => resultFor(e.id)?.finding === 'satisfied')) {
    disposition = 'established'
  } else {
    disposition = 'contested'
  }

  return {
    claim,
    ruleId: rule.id,
    elementResults: results,
    supporting: [...supporting],
    contrary: [...contrary],
    disposition,
    declinedReason,
    confidence: disposition === 'declined' ? 0 : worst,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Triage — the GREEN / YELLOW / RED the commercial plugin returns
// ─────────────────────────────────────────────────────────────────────────────

export type Triage = 'green' | 'yellow' | 'red'

export interface TriageResult {
  verdict: Triage
  reasons: string[]
}

/**
 * Collapse a set of mappings into one routing verdict.
 *
 * RED is reserved for things a lawyer must see: an unsupported required element, a
 * contrary binding authority, or a claim that reached 'established' on authority that is
 * no longer good law. YELLOW is "a human should read this". GREEN is "no exception taken".
 */
export function triageMappings(mappings: ClaimMapping[], authorities: Authority[]): TriageResult {
  const byId = new Map(authorities.map((a) => [a.id, a]))
  const reasons: string[] = []

  const declined = mappings.filter((m) => m.disposition === 'declined')
  const unsupported = mappings.filter((m) => m.disposition === 'unsupported')
  const contested = mappings.filter((m) => m.disposition === 'contested')

  for (const mapping of unsupported) {
    reasons.push(`Required element not satisfied: ${mapping.claim}`)
  }

  for (const mapping of mappings) {
    for (const id of mapping.contrary) {
      const authority = byId.get(id)
      if (authority && authority.tier === 'case-binding') {
        reasons.push(`Contrary binding authority: ${authority.citation}`)
      }
    }
  }

  for (const mapping of mappings) {
    if (mapping.disposition !== 'established') continue
    for (const id of mapping.supporting) {
      const authority = byId.get(id)
      if (authority && (authority.status === 'overruled' || authority.status === 'superseded')) {
        reasons.push(`Relies on ${authority.status} authority: ${authority.citation}`)
      }
    }
  }

  if (reasons.length > 0) return { verdict: 'red', reasons }

  for (const mapping of contested) {
    reasons.push(`Unresolved on the sources: ${mapping.claim}`)
  }
  for (const mapping of declined) {
    reasons.push(`Not addressed by the corpus: ${mapping.claim}`)
  }
  if (mappings.some((m) => m.confidence < 50 && m.disposition === 'established')) {
    reasons.push('Conclusion rests on authority of limited weight')
  }

  if (reasons.length > 0) return { verdict: 'yellow', reasons }
  return { verdict: 'green', reasons: ['No deviation from the standard position'] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Playbooks — the deviation board
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'minor' | 'material' | 'critical'

export interface FallbackRung {
  id: string
  text: string
  /** Who may approve accepting this rung. Empty when nobody may. */
  approver: string
  severity: Severity
}

export interface PlaybookPosition {
  clauseId: string
  clauseName: string
  /** The position the team actually takes, not a market average. */
  standard: string
  /** Ordered ladder of acceptable retreats, best first. */
  fallbacks: FallbackRung[]
  /** The point past which the team declines the deal rather than the clause. */
  walkAway: string
}

/** What the reading pass observed. The model produces this; the routing below owns it. */
export interface ClauseFinding {
  /** Which rung of the ladder the observed language sits on. */
  match: 'standard' | 'fallback' | 'outside' | 'missing'
  /** 0–100 — how sure the read is. Low confidence routes to a human, never to GREEN. */
  confidence: number
  fallbackId?: string
  anchor?: Anchor
  observed?: string
}

export interface Deviation {
  clauseId: string
  clauseName: string
  match: ClauseFinding['match']
  verdict: Triage
  severity: Severity
  approver: string
  rationale: string
  anchor?: Anchor
}

/**
 * Decide the consequence of a clause finding.
 *
 * The interesting branch is confidence, not severity. A confident 'outside' is a clean RED
 * with a named approver; an unconfident 'standard' is YELLOW, because a low-confidence pass
 * in the safe direction is exactly the case where an automated GREEN does the most damage.
 */
export function evaluateClause(position: PlaybookPosition, finding: ClauseFinding): Deviation {
  const rung = finding.fallbackId
    ? position.fallbacks.find((f) => f.id === finding.fallbackId)
    : undefined

  const base = {
    clauseId: position.clauseId,
    clauseName: position.clauseName,
    match: finding.match,
    anchor: finding.anchor,
  }

  if (finding.match === 'missing') {
    return {
      ...base,
      verdict: 'red',
      severity: 'critical',
      approver: 'Supervising counsel',
      rationale: `${position.clauseName} is absent. Standard position: ${position.standard}`,
    }
  }

  if (finding.match === 'outside') {
    return {
      ...base,
      verdict: 'red',
      severity: 'critical',
      approver: 'Supervising counsel',
      rationale: `Outside the ladder. Walk-away point: ${position.walkAway}`,
    }
  }

  if (finding.match === 'standard') {
    if (finding.confidence < 70) {
      return {
        ...base,
        verdict: 'yellow',
        severity: 'minor',
        approver: 'Reviewing counsel',
        rationale: `Read as the standard position at ${finding.confidence}% confidence — confirm before clearing.`,
      }
    }
    return {
      ...base,
      verdict: 'green',
      severity: 'minor',
      approver: 'None required',
      rationale: 'Matches the standard position.',
    }
  }

  // 'fallback' — accepted only up to the rung that was actually reached.
  if (!rung) {
    return {
      ...base,
      verdict: 'yellow',
      severity: 'material',
      approver: 'Reviewing counsel',
      rationale: 'Falls back to a rung that is not on this playbook — route for a decision.',
    }
  }

  const verdict: Triage = finding.confidence < 70 ? 'yellow' : rung.severity === 'critical' ? 'red' : 'yellow'
  return {
    ...base,
    verdict,
    severity: rung.severity,
    approver: rung.approver || 'Supervising counsel',
    rationale: `${rung.text}${finding.confidence < 70 ? ` (read at ${finding.confidence}% confidence)` : ''}`,
  }
}

/** One routing line per deviation, for the escalation flagger. */
export function escalationLine(deviation: Deviation): string {
  const tag = deviation.verdict.toUpperCase().padEnd(6)
  return `${tag} ${deviation.clauseName} → ${deviation.approver}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

export interface MappingSummary {
  established: number
  contested: number
  unsupported: number
  declined: number
  /** Mean confidence across mappings that reached a conclusion. */
  meanConfidence: number
  verdict: Triage
  reasons: string[]
}

export function summarise(mappings: ClaimMapping[], authorities: Authority[]): MappingSummary {
  const triage = triageMappings(mappings, authorities)
  const concluded = mappings.filter((m) => m.disposition !== 'declined')

  const meanConfidence = concluded.length
    ? Math.round(concluded.reduce((sum, m) => sum + m.confidence, 0) / concluded.length)
    : 0

  return {
    established: mappings.filter((m) => m.disposition === 'established').length,
    contested: mappings.filter((m) => m.disposition === 'contested').length,
    unsupported: mappings.filter((m) => m.disposition === 'unsupported').length,
    declined: mappings.filter((m) => m.disposition === 'declined').length,
    meanConfidence,
    verdict: triage.verdict,
    reasons: triage.reasons,
  }
}

/**
 * Locate a quote inside the stored text and return an anchor, or null when the quote is not
 * present verbatim. Used to reject a model's citation that does not actually appear in the
 * source — the failure mode a page number can never catch.
 */
export function anchorQuote(
  sourceId: string,
  text: string,
  quote: string,
  locator: string,
): Anchor | null {
  const trimmed = quote.trim()
  if (!trimmed) return null
  const start = text.indexOf(trimmed)
  if (start < 0) return null
  return { sourceId, locator, start, end: start + trimmed.length, quote: trimmed }
}
