/**
 * argumentEngine.ts — the structured possibility graph behind a live oral argument.
 *
 * The problem this solves is not "generate an argument". It is that a real advocate does not
 * hold one theory: they hold a ranked set of them, each with premises that must survive contact
 * with the other side, and they *switch* when the opposing opening reveals which premise is
 * contested. A single general model asked to "argue for the plaintiff" cannot do that, because it
 * has no representation of what it would have argued instead.
 *
 * The model here is deliberately borrowed from simulation frameworks rather than from chatbots:
 * an ONTOLOGY (what must be proved), a MOVE LIBRARY (ways to prove it, each with premises, risk
 * and payoff), a READ (what the opponent's opening actually committed them to), and a SCORER that
 * re-ranks the library against that read. Switching is then not a stylistic choice — it is the
 * arithmetic consequence of the read changing which premises are still available.
 *
 * Everything is deterministic and pure. The language model writes prose from a chosen strategy;
 * it does not choose the strategy. That split is what makes the adaptation inspectable: every
 * switch can be explained as a before/after pair of expected values.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ontology — what has to be established, and by whom
// ─────────────────────────────────────────────────────────────────────────────

export type DomainId = 'property' | 'contracts' | 'constitutional' | 'torts'

export type Burden = 'plaintiff' | 'defendant' | 'movant' | 'respondent'

export interface DoctrineElement {
  id: string
  label: string
  /** The test as the cases state it, short enough to quote in argument. */
  test: string
  burden: Burden
  /** Elements that are commonly conceded and therefore bad ground to fight on. */
  usuallyConceded: boolean
}

export interface Ontology {
  domain: DomainId
  label: string
  /** The one-sentence frame the whole argument is fought inside. */
  frame: string
  elements: DoctrineElement[]
}

export const ONTOLOGIES: Ontology[] = [
  {
    domain: 'property',
    label: 'Property & Future Interests',
    frame: 'Who holds a presently enforceable interest, and when does it vest beyond doubt?',
    elements: [
      { id: 'interest', label: 'A recognized interest was created', test: 'Language of grant plus delivery or deed', burden: 'plaintiff', usuallyConceded: true },
      { id: 'vesting', label: 'The interest has vested', test: 'No condition precedent outstanding; ascertained holder', burden: 'plaintiff', usuallyConceded: false },
      { id: 'rap', label: 'The interest does not offend the Rule Against Perpetuities', test: 'Must vest, if at all, within 21 years of a life in being', burden: 'plaintiff', usuallyConceded: false },
      { id: 'exclusion', label: 'The right to exclude was violated or preserved', test: 'Substantial interference with possessory right', burden: 'plaintiff', usuallyConceded: false },
      { id: 'equity', label: 'Equitable considerations support the result', test: 'Unjust enrichment, reliance, or clean hands', burden: 'defendant', usuallyConceded: false },
    ],
  },
  {
    domain: 'contracts',
    label: 'Contracts & Commercial',
    frame: 'Was a promise made enforceable, and on whose terms?',
    elements: [
      { id: 'assent', label: 'Mutual assent', test: 'Offer and acceptance on materially identical terms', burden: 'plaintiff', usuallyConceded: true },
      { id: 'consideration', label: 'Consideration', test: 'Bargained-for exchange or a substitute doctrine', burden: 'plaintiff', usuallyConceded: false },
      { id: 'terms', label: 'The term at issue is part of the agreement', test: 'Battle of the forms, course of dealing, or incorporation', burden: 'plaintiff', usuallyConceded: false },
      { id: 'performance', label: 'Performance or a valid excuse', test: 'Material breach, impracticability, or frustration', burden: 'defendant', usuallyConceded: false },
      { id: 'remedy', label: 'The remedy requested is available', test: 'Expectation, reliance, or specific performance', burden: 'plaintiff', usuallyConceded: false },
    ],
  },
  {
    domain: 'constitutional',
    label: 'Constitutional & Historical',
    frame: 'What did the text commit, and to which institution?',
    elements: [
      { id: 'text', label: 'Textual commitment', test: 'Plain meaning and structure of the clause', burden: 'movant', usuallyConceded: true },
      { id: 'history', label: 'Original understanding', test: 'Ratification-era evidence and early practice', burden: 'movant', usuallyConceded: false },
      { id: 'precedent', label: 'Controlling precedent', test: 'Binding holding, not dictum', burden: 'respondent', usuallyConceded: false },
      { id: 'standard', label: 'The applicable standard of review', test: 'Strict, intermediate, or rational basis', burden: 'respondent', usuallyConceded: false },
      { id: 'institutional', label: 'Institutional competence', test: 'Which branch the Constitution empowered to decide', burden: 'movant', usuallyConceded: false },
    ],
  },
  {
    domain: 'torts',
    label: 'Torts & Civil Liability',
    frame: 'Did a duty run to this plaintiff, was it broken, and did that breach cause this harm?',
    elements: [
      { id: 'duty', label: 'A duty ran to this plaintiff', test: 'Foreseeable plaintiff within the zone of danger', burden: 'plaintiff', usuallyConceded: true },
      { id: 'breach', label: 'The standard of care was breached', test: 'Reasonable person, or B < P × L where the burden is measurable', burden: 'plaintiff', usuallyConceded: false },
      { id: 'cause', label: 'Actual and proximate cause', test: 'But-for cause, plus harm within the risk', burden: 'plaintiff', usuallyConceded: false },
      { id: 'harm', label: 'Legally cognizable harm', test: 'Physical injury, or a recognized emotional or economic loss', burden: 'plaintiff', usuallyConceded: false },
      { id: 'defense', label: 'No complete defence', test: 'Comparative fault reduces; assumption of risk or privilege bars', burden: 'defendant', usuallyConceded: false },
    ],
  },
]

export function ontologyFor(domain: DomainId): Ontology {
  return ONTOLOGIES.find((o) => o.domain === domain) ?? ONTOLOGIES[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// Move library — the possibilities, each with what it needs to survive
// ─────────────────────────────────────────────────────────────────────────────

export type MoveKind =
  | 'assert'
  | 'distinguish'
  | 'reframe'
  | 'concede'
  | 'burden-shift'
  | 'analogy'
  | 'policy'

export interface ArgumentMove {
  id: string
  domain: DomainId
  kind: MoveKind
  claim: string
  authority: string
  elementId: string
  /** Facts or readings this move depends on. If one is contested, the move is exposed. */
  premises: string[]
  /** Exposure if the premises are met (0–100). */
  risk: number
  /** Gain if the premises hold (0–100). */
  payoff: number
  /** Opponent premises that blunt this move, with how much they blunt it (0–1). */
  bluntedBy: Array<{ premise: string; factor: number }>
}

export const MOVES: ArgumentMove[] = [
  // ── Property (Makdisi's ground: strict logic, then natural law) ─────────────
  {
    id: 'prop-vesting-chain',
    domain: 'property',
    kind: 'assert',
    claim: 'The interest is vested subject to open, so no condition precedent can defeat it.',
    authority: 'Restatement (Second) of Property (Donative Transfers), classification of estates',
    elementId: 'vesting',
    premises: ['grantor used words of present transfer', 'no unascertained class remains'],
    risk: 55,
    payoff: 80,
    bluntedBy: [{ premise: 'grantor used words of future transfer', factor: 0.7 }],
  },
  {
    id: 'prop-rap',
    domain: 'property',
    kind: 'distinguish',
    claim: 'The executory interest could not vest within lives in being plus 21 years, so it fails.',
    authority: 'Duke of Norfolk’s Case, 3 Ch. Cas. 1, 22 Eng. Rep. 931 (1682)',
    elementId: 'rap',
    premises: ['measuring life is a person in being', 'class not closed within 21 years'],
    risk: 40,
    payoff: 95,
    bluntedBy: [{ premise: 'the grant was reformed by statute', factor: 0.8 }],
  },
  {
    id: 'prop-exclusion',
    domain: 'property',
    kind: 'assert',
    claim: 'The right to exclude is not a formality; interference with it is actionable without proof of damage.',
    authority: 'Jacque v. Steenberg Homes, Inc., 563 N.W.2d 154 (Wis. 1997)',
    elementId: 'exclusion',
    premises: ['defendant entered land', 'no privilege or necessity'],
    risk: 35,
    payoff: 70,
    bluntedBy: [{ premise: 'necessity justified the entry', factor: 0.75 }],
  },
  {
    id: 'prop-equity',
    domain: 'property',
    kind: 'policy',
    claim: 'Whatever the positive rule, applying it here would be uncaring justice; the object of the moral act is to preserve human flourishing.',
    authority: 'Aquinas, Summa Theologiae II-II q.66; natural-law critique of rigid positive law',
    elementId: 'equity',
    premises: ['the rule produces an unjust result on these facts', 'the holder seeks purely formal advantage'],
    risk: 60,
    payoff: 65,
    bluntedBy: [{ premise: 'the legislature settled the balance', factor: 0.6 }],
  },

  // ── Contracts (Fisher's ground: real-world policy and synthesis) ────────────
  {
    id: 'con-assent',
    domain: 'contracts',
    kind: 'assert',
    claim: 'A reasonable person would read the exchange as an offer accepted by performance.',
    authority: 'Restatement (Second) of Contracts §§ 19, 50',
    elementId: 'assent',
    premises: ['objective manifestations', 'communication of acceptance'],
    risk: 30,
    payoff: 65,
    bluntedBy: [{ premise: 'terms were still being negotiated', factor: 0.7 }],
  },
  {
    id: 'con-consideration',
    domain: 'contracts',
    kind: 'reframe',
    claim: 'Even without consideration, reliance makes the promise enforceable to the extent of the injury.',
    authority: 'Restatement (Second) of Contracts § 90',
    elementId: 'consideration',
    premises: ['a promise was made', 'the promise induced definite reliance'],
    risk: 45,
    payoff: 80,
    bluntedBy: [{ premise: 'reliance was speculative or unforeseeable', factor: 0.65 }],
  },
  {
    id: 'con-terms',
    domain: 'contracts',
    kind: 'distinguish',
    claim: 'The clause is an additional term that dropped out under § 2-207(2).',
    authority: 'U.C.C. § 2-207 cmt. 3',
    elementId: 'terms',
    premises: ['both parties used forms', 'term was material'],
    risk: 50,
    payoff: 75,
    bluntedBy: [{ premise: 'the parties are merchants and the term was not objected to', factor: 0.55 }],
  },
  {
    id: 'con-impracticability',
    domain: 'contracts',
    kind: 'concede',
    claim: 'We concede the price rose, but increased cost is not impracticability; performance was never prevented.',
    authority: 'Transatlantic Financing Corp. v. United States, 363 F.2d 312 (D.C. Cir. 1966)',
    elementId: 'performance',
    premises: ['the event was foreseeable', 'performance remained possible'],
    risk: 25,
    payoff: 60,
    bluntedBy: [{ premise: 'performance became objectively impossible', factor: 0.8 }],
  },

  // ── Constitutional (Upham's ground: text, history, institutional design) ────
  {
    id: 'con-text',
    domain: 'constitutional',
    kind: 'assert',
    claim: 'The clause commits this decision to a named institution, and that commitment is exclusive.',
    authority: 'U.S. Const. art. II, § 2; The Federalist No. 64',
    elementId: 'text',
    premises: ['the text names the institution', 'no textual warrant for judicial substitution'],
    risk: 40,
    payoff: 85,
    bluntedBy: [{ premise: 'the text is silent and practice supplies the meaning', factor: 0.6 }],
  },
  {
    id: 'con-history',
    domain: 'constitutional',
    kind: 'analogy',
    claim: 'Early practice after ratification is the best evidence of what the generation that adopted it understood.',
    authority: 'Marbury v. Madison, 5 U.S. (1 Cranch) 137 (1803); ratification-era practice',
    elementId: 'history',
    premises: ['the practice was contemporaneous', 'it was publicly defended'],
    risk: 50,
    payoff: 75,
    bluntedBy: [{ premise: 'the practice was contested at the time', factor: 0.7 }],
  },
  {
    id: 'con-institutional',
    domain: 'constitutional',
    kind: 'policy',
    claim: 'Judicial resolution here displaces a political judgment the Constitution left to another branch.',
    authority: 'Baker v. Carr, 369 U.S. 186 (1962) (political question factors)',
    elementId: 'institutional',
    premises: ['a textually demonstrable commitment exists', 'no judicially manageable standard'],
    risk: 45,
    payoff: 70,
    bluntedBy: [{ premise: 'a manageable standard is available', factor: 0.75 }],
  },

  // ── Torts (De Wolf's ground: categorise, number the elements, reveal the design) ──
  {
    id: 'tort-duty',
    domain: 'torts',
    kind: 'assert',
    claim: 'The duty ran to this plaintiff: she was in the zone of danger the conduct created, and foreseeability fixes the class.',
    authority: 'Palsgraf v. Long Island Railroad Co., 248 N.Y. 339 (1928) (Cardozo, C.J.)',
    elementId: 'duty',
    premises: ['the plaintiff was foreseeably endangered', 'the harm was within the risk created'],
    risk: 35,
    payoff: 80,
    bluntedBy: [{ premise: 'the harm was to an unforeseeable class', factor: 0.8 }],
  },
  {
    id: 'tort-breach',
    domain: 'torts',
    kind: 'assert',
    claim: 'A reasonable person would have taken the precaution; the burden was slight and the loss severe.',
    authority: 'United States v. Carroll Towing Co., 159 F.2d 169 (2d Cir. 1947) (B < P × L)',
    elementId: 'breach',
    premises: ['the burden of precaution was measurable', 'the risk was foreseeable and serious'],
    risk: 30,
    payoff: 70,
    bluntedBy: [{ premise: 'the precaution was impractical or unknown to the trade', factor: 0.7 }],
  },
  {
    id: 'tort-cause',
    domain: 'torts',
    kind: 'distinguish',
    claim: 'The intervening act broke the chain; this harm was not within the risk that made the conduct negligent.',
    authority: 'Palsgraf v. Long Island Railroad Co., 248 N.Y. 339 (1928) (Andrews, J., dissenting on cause)',
    elementId: 'cause',
    premises: ['an independent intervening act occurred', 'the harm was outside the risk created'],
    risk: 50,
    payoff: 85,
    bluntedBy: [{ premise: 'the intervening act was a foreseeable response', factor: 0.75 }],
  },
  {
    id: 'tort-design',
    domain: 'torts',
    kind: 'policy',
    claim: 'Read the rule by its design, not by its accidents: the element exists to protect a specific interest, and the instruction must say which.',
    authority: 'Restatement (Second) of Torts § 281; the rule’s inherent purpose',
    elementId: 'defense',
    premises: ['the rule has an identifiable purpose', 'the proposed reading defeats that purpose'],
    risk: 45,
    payoff: 65,
    bluntedBy: [{ premise: 'the legislature displaced the common-law purpose', factor: 0.65 }],
  },
]

export function movesFor(domain: DomainId): ArgumentMove[] {
  return MOVES.filter((m) => m.domain === domain)
}

/**
 * Report any premise a move names as blunting it that the reader cannot ever detect.
 *
 * This is the failure mode that made a strategy switch silently impossible: the move library and
 * the premise reader are two lists that must stay in step, and nothing in the type system relates
 * them. A move whose stated weakness is unreachable will hold its position no matter what the
 * other side says, which reads exactly like a model that refuses to adapt.
 */
export function validateArgumentLibrary(): string[] {
  const readable = new Set(PREMISE_PATTERNS.map((pattern) => pattern.premise))
  const orphans: string[] = []
  for (const move of MOVES) {
    for (const blunt of move.bluntedBy) {
      if (!readable.has(blunt.premise)) {
        orphans.push(`${move.id} claims "${blunt.premise}", which no reader pattern produces`)
      }
    }
  }
  return orphans
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the opposing opening
// ─────────────────────────────────────────────────────────────────────────────

interface PremisePattern {
  premise: string
  markers: string[]
}

const PREMISE_PATTERNS: PremisePattern[] = [
  { premise: 'grantor used words of present transfer', markers: ['hereby grants', 'conveys to', 'to a for life'] },
  { premise: 'grantor used words of future transfer', markers: ['upon the death of', 'at such time as', 'shall then'] },
  { premise: 'measuring life is a person in being', markers: ['lives in being', 'measuring life'] },
  { premise: 'class not closed within 21 years', markers: ['twenty-one years', '21 years', 'perpetuit'] },
  { premise: 'defendant entered land', markers: ['entered', 'trespass', 'crossed'] },
  { premise: 'necessity justified the entry', markers: ['necessity', 'emergency', 'to save'] },
  { premise: 'the rule produces an unjust result on these facts', markers: ['unjust', 'harsh', 'unfair', 'disproportionate'] },
  { premise: 'the legislature settled the balance', markers: ['statute provides', 'legislature', 'the code says'] },
  { premise: 'terms were still being negotiated', markers: ['subject to contract', 'non-binding', 'letter of intent'] },
  { premise: 'reliance was speculative or unforeseeable', markers: ['speculative', 'unforeseeable', 'no reliance'] },
  { premise: 'the parties are merchants and the term was not objected to', markers: ['merchant', 'course of dealing', 'never objected'] },
  { premise: 'performance became objectively impossible', markers: ['impossible', 'destroyed', 'cannot be performed'] },
  { premise: 'the text names the institution', markers: ['the text', 'article ii', 'article iii', 'plain meaning'] },
  { premise: 'the practice was contested at the time', markers: ['contested', 'disputed', 'was not settled'] },
  { premise: 'the statute is strict liability for this element', markers: ['strict liability', 'regardless of intent'] },
  { premise: 'the officer observed a weapon before the frisk', markers: ['bulge', 'weapon', 'saw the gun'] },
  { premise: 'the intervening act was a foreseeable response', markers: ['foreseeable', 'predictable', 'natural consequence'] },
  // ── torts ──
  { premise: 'the plaintiff was foreseeably endangered', markers: ['zone of danger', 'foreseeable plaintiff', 'within the risk'] },
  { premise: 'the harm was to an unforeseeable class', markers: ['unforeseeable', 'outside the risk', 'no duty ran'] },
  { premise: 'the burden of precaution was measurable', markers: ['burden of precaution', 'cost of precaution', 'cheaply'] },
  { premise: 'the precaution was impractical or unknown to the trade', markers: ['impractical', 'industry standard', 'custom of the trade'] },
  { premise: 'the harm was outside the risk created', markers: ['outside the risk', 'not within the risk', 'remote'] },
  { premise: 'the rule has an identifiable purpose', markers: ['the rule exists to', 'its purpose', 'by design'] },
  { premise: 'the legislature displaced the common-law purpose', markers: ['the legislature', 'codified', 'statute displaced'] },
  // These three exist because a move declared itself vulnerable to them and no reader pattern
  // could ever produce them — so the graph advertised a weakness that could never fire, and the
  // attorney held a position its own model said was exposed. `validateArgumentLibrary()` now
  // reports any such orphan.
  { premise: 'the grant was reformed by statute', markers: ['reformed by statute', 'statutorily reformed', 'reformed the grant'] },
  { premise: 'a manageable standard is available', markers: ['manageable standard', 'judicially manageable'] },
  { premise: 'the text is silent and practice supplies the meaning', markers: ['the text is silent', 'silent on the question', 'practice supplies'] },
]

const CONCESSION_MARKERS = ['we concede', 'we accept', 'it is undisputed', 'we do not contest', 'admittedly']

/**
 * A premise can be withdrawn, and a withdrawn premise must stop scoring.
 *
 * Borrowed from the simulation pattern this engine is modelled on: facts carry an `invalid_at`
 * rather than being deleted, so a concession that is later retracted simply ceases to be current.
 * Without it, "we concede foreseeability — and we withdraw that concession" would leave the
 * attorney fighting a premise the other side had already abandoned, which is the opposite of
 * adaptivity.
 */
const RETRACTION_MARKERS = [
  'we withdraw',
  'we retract',
  'we no longer contend',
  'we abandon',
  'striking that',
  'withdraw that concession',
]

export interface OpponentRead {
  premises: string[]
  elementsStressed: string[]
  /** Premises the opponent gave away, which the other side may now rely on. */
  concessions: string[]
  /** Premises the opponent committed to and then withdrew; excluded from `premises`. */
  retracted: string[]
  /** Tokens that drove the read, kept so the interface can show its work. */
  signals: string[]
}

/**
 * What the opponent actually committed to, in sentence order.
 *
 * Deliberately mechanical: premises are recognised by their marker phrases, not inferred by a
 * model. The deterministic read is what a switch is justified against, so the adaptation cannot be
 * explained after the fact by whatever the model felt like saying.
 *
 * Sentences are processed in order because a premise can be withdrawn after it is asserted, and a
 * withdrawn premise must stop counting — see RETRACTION_MARKERS.
 */
export function readOpening(text: string, ontology: Ontology): OpponentRead {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0)

  const premises: string[] = []
  const retracted: string[] = []
  const signals: string[] = []
  const concessions: string[] = []

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const withdrawing = RETRACTION_MARKERS.some((marker) => lower.includes(marker))

    if (CONCESSION_MARKERS.some((marker) => lower.includes(marker))) {
      concessions.push(sentence.trim())
    }

    for (const pattern of PREMISE_PATTERNS) {
      const hit = pattern.markers.find((marker) => lower.includes(marker))
      if (!hit) continue
      if (!signals.includes(hit)) signals.push(hit)

      if (withdrawing && premises.includes(pattern.premise)) {
        // A withdrawal only withdraws something that was actually taken. "We withdraw that
        // concession — the harm was to an unforeseeable class" both retracts an earlier premise
        // and asserts a new one, and treating the assertion as retracted would silently discard
        // the strongest thing the advocate said.
        premises.splice(premises.indexOf(pattern.premise), 1)
        if (!retracted.includes(pattern.premise)) retracted.push(pattern.premise)
      } else if (!premises.includes(pattern.premise)) {
        premises.push(pattern.premise)
      }
    }
  }

  // A later unqualified assertion revives a withdrawn premise.
  if (retracted.length) {
    const lastWithdrawal = sentences.map((s) =>
      RETRACTION_MARKERS.some((m) => s.toLowerCase().includes(m)),
    )
    const lastIndex = lastWithdrawal.lastIndexOf(true)
    const after = sentences.slice(lastIndex + 1).join(' ').toLowerCase()
    for (const premise of [...retracted]) {
      const pattern = PREMISE_PATTERNS.find((p) => p.premise === premise)
      if (pattern?.markers.some((marker) => after.includes(marker))) {
        retracted.splice(retracted.indexOf(premise), 1)
        if (!premises.includes(premise)) premises.push(premise)
      }
    }
  }

  const elementsStressed: string[] = []
  const lower = String(text || '').toLowerCase()
  for (const element of ontology.elements) {
    const words = element.label.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
    if (words.some((word) => lower.includes(word))) elementsStressed.push(element.id)
  }

  return { premises, elementsStressed, concessions, retracted, signals }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring and adaptive switching
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoredMove {
  move: ArgumentMove
  /** Expected value 0–100 after the read. */
  value: number
  /** How much of the move's premise set survived contact with the opposing opening. */
  survival: number
  blunted: Array<{ premise: string; factor: number }>
  /** True when the move's own element is one the opponent conceded. */
  onConcededGround: boolean
}

export function scoreMoves(
  moves: ArgumentMove[],
  read: OpponentRead,
  ontology: Ontology,
): ScoredMove[] {
  const concededElements = new Set(
    ontology.elements.filter((e) => e.usuallyConceded).map((e) => e.id),
  )

  return moves
    .map((move) => {
      const blunted = move.bluntedBy.filter((b) => read.premises.includes(b.premise))

      // Survival is multiplicative: two half-blunted premises leave a quarter of the move.
      const survival = blunted.reduce((acc, b) => acc * (1 - b.factor), 1)

      // Fighting on ground the doctrine already gives you is wasted breath.
      const onConcededGround = concededElements.has(move.elementId)
      const groundPenalty = onConcededGround ? 0.7 : 1

      const value = Math.max(
        0,
        Math.round((move.payoff * survival - move.risk * (1 - survival)) * groundPenalty),
      )

      return { move, value, survival, blunted, onConcededGround }
    })
    .sort((a, b) => b.value - a.value)
}

export interface StrategyChoice {
  primary: ScoredMove
  alternates: ScoredMove[]
  /** Set when the choice differs from the previous round's primary. */
  switchedFrom?: ScoredMove
  /** Always populated — the interface shows this, so a switch is never unexplained. */
  reason: string
}

/**
 * Choose a strategy, and say why it changed.
 *
 * The reason string is composed from the arithmetic, not written by a model: it names the move
 * abandoned, the move adopted, and the opposing premise that moved the value. That is the whole
 * point of separating strategy from prose.
 */
export function chooseStrategy(
  moves: ArgumentMove[],
  read: OpponentRead,
  ontology: Ontology,
  previous?: { id: string; value: number },
): StrategyChoice {
  const ranked = scoreMoves(moves, read, ontology)
  if (!ranked.length) {
    throw new Error('No argument moves are defined for this domain.')
  }

  const [primary, ...rest] = ranked
  const previousScored = previous ? ranked.find((r) => r.move.id === previous.id) : undefined
  const switched = previousScored && previousScored.move.id !== primary.move.id

  let reason: string
  if (!previous) {
    reason = read.premises.length
      ? `Opened on ${primary.move.kind} "${primary.move.claim.slice(0, 60)}…" because the opposing opening exposed ${read.premises.length} premise(s), and this move survives them.`
      : `Opened on ${primary.move.kind} because no opposing premise has been committed to yet.`
  } else if (switched && previousScored) {
    const dropped = previousScored.value - primary.value
    const trigger = primary.blunted.length
      ? primary.blunted.map((b) => `"${b.premise}"`).join(' and ')
      : read.signals.slice(0, 2).map((s) => `"${s}"`).join(' and ')
    reason =
      `Switched from "${previousScored.move.claim.slice(0, 50)}…" (now ${previousScored.value}) ` +
      `to this (${primary.value}) after hearing ${trigger || 'the opposing premises'}. ` +
      (dropped < 0
        ? 'The abandoned move lost more of its premise set to the opening than this one did.'
        : 'The opening ruled out the earlier line.')
  } else {
    reason =
      `Holding the same line: no opposing premise reduced its expected value below the alternatives ` +
      `(still ${primary.value}, next best ${rest[0]?.value ?? '—'}).`
  }

  return {
    primary,
    alternates: rest.slice(0, 3),
    switchedFrom: switched ? previousScored : undefined,
    reason,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcript bookkeeping
// ─────────────────────────────────────────────────────────────────────────────

export type Speaker = 'advocate' | 'attorney' | 'bench'

export interface Exchange {
  id: string
  speaker: Speaker
  text: string
  /** The strategy the attorney was operating under when this was said. */
  moveId?: string
  value?: number
  switched?: boolean
}

export interface ArgumentState {
  domain: DomainId
  exchanges: Exchange[]
  /** Strategy the attorney was last operating under. */
  lastMoveId?: string
  lastValue?: number
  round: number
}

export function nextRound(state: ArgumentState): ArgumentState {
  return { ...state, round: state.round + 1 }
}

/**
 * Everything the advocate has said, as one block. The attorney reads the opponent's *opening*
 * for the first switch and the whole exchange thereafter — because a later move can concede
 * something the opening only implied.
 */
export function advocateText(state: ArgumentState): string {
  return state.exchanges
    .filter((e) => e.speaker === 'advocate')
    .map((e) => e.text)
    .join('\n\n')
}
