/**
 * domain-classifier.js — assigns each corpus chunk to a practice domain.
 *
 * Why this exists as its own module rather than inline in the builder: two things need the same
 * answer. The build tags chunks once, and rag.js needs to tag the hand-maintained seed file whose
 * entries predate the tag. A second copy of these rules would drift, and the failure would be
 * silent — a chunk filed under the wrong domain simply never surfaces for the attorney who needed
 * it, and nothing reports the gap.
 *
 * Scoring is deliberately crude and explainable. A legal document announces its subject in its
 * title and its first page far more reliably than it does in its vocabulary, so the classifier
 * weights title hits above body hits and requires a minimum score before it will commit. Anything
 * that scores below the threshold is 'general' — cross-cutting material that belongs to no single
 * domain, which is honest about the fact rather than guessing.
 */

'use strict'

/** Higher weight = stronger evidence that the chunk belongs to this domain. */
const DOMAINS = [
  {
    domain: 'property',
    terms: [
      'future interest', 'perpetuit', 'fee simple', 'remainder', 'reversion', 'conveyance',
      'easement', 'covenant', 'landlord', 'tenant', 'adverse possession', 'recording act',
      'deed', 'mortgage', 'homestead', 'estate in land', 'quiet title', 'eminent domain',
      'restatement of the law, second, property', 'donative transaction', 'concurrent estate',
    ],
  },
  {
    domain: 'contracts',
    terms: [
      'uniform commercial code', 'sale of goods', 'promissory estoppel', 'consideration',
      'statute of frauds', 'offer and acceptance', 'warranty', 'negotiable instrument',
      'u.c.c', 'ucc', 'restatement of contracts', 'restatement (second) of contracts',
      'impracticability', 'liquidated damages', 'course of dealing', 'arbitration',
    ],
  },
  {
    domain: 'constitutional',
    terms: [
      'constitution', 'amendment', 'federalist', 'judicial review', 'due process',
      'equal protection', 'commerce clause', 'first amendment', 'fourteenth', 'fourth amendment',
      'separation of powers', 'bill of rights', 'marbury', 'supremacy clause', 'privileges or immunities',
      'constitution annotated', 'ratification',
    ],
  },
  {
    domain: 'torts',
    terms: [
      'tort', 'negligence', 'strict liability', 'products liability', 'assault', 'battery',
      'defamation', 'nuisance', 'proximate cause', 'duty of care', 'palsgraf', 'res ipsa',
      'comparative fault', 'assumption of risk', 'restatement of the law, second, torts',
      'learned hand', 'premises liability',
    ],
  },
  {
    domain: 'criminal',
    terms: [
      'criminal procedure', 'fourth amendment', 'fifth amendment', 'sixth amendment',
      'search and seizure', 'probable cause', 'reasonable suspicion', 'exclusionary rule',
      'miranda', 'custodial interrogation', 'suppression motion', 'stop and frisk',
      'arrest warrant', 'search warrant', 'mens rea', 'actus reus', 'confession',
      'plea bargain', 'grand jury', 'double jeopardy',
    ],
  },
]

/**
 * A chunk needs at least this much evidence before it is filed under a domain.
 *
 * Two, not three: a multi-word legal phrase ("restatement of contracts") already scores two, and
 * requiring three meant a volume whose entire title names its subject was still filed as 'general'
 * unless a second signal happened to appear. That is how a Restatement of Contracts landed in the
 * general pool and left the contracts attorney with 34 chunks.
 */
const MIN_SCORE = 2

/**
 * @param {string} text  Combined haystack: path, title, and the opening of the content.
 * @returns {{ domain: string, scores: Record<string, number>, best: number }}
 */
function classifyDomain(text) {
  const haystack = String(text || '').toLowerCase()
  const scores = {}

  for (const { domain, terms } of DOMAINS) {
    let score = 0
    for (const term of terms) {
      if (!haystack.includes(term)) continue
      // Multi-word terms are more specific, so a hit on one is better evidence than a hit on a
      // single generic word like "deed" appearing inside an unrelated regulation.
      score += term.includes(' ') ? 2 : 1
    }
    scores[domain] = score
  }

  let domain = 'general'
  let best = 0
  for (const [key, score] of Object.entries(scores)) {
    if (score > best) {
      best = score
      domain = key
    }
  }

  if (best < MIN_SCORE) return { domain: 'general', scores, best }

  // A tie means the text genuinely straddles two domains; 'general' is the safer answer than an
  // arbitrary winner, because a misfiled chunk is invisible rather than merely coarsely filed.
  const leaders = Object.entries(scores).filter(([, score]) => score === best)
  if (leaders.length > 1) return { domain: 'general', scores, best }

  return { domain, scores, best }
}

module.exports = { classifyDomain, DOMAINS, MIN_SCORE }
