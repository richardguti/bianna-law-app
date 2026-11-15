/**
 * practiceProfile.ts — the storage contract for the cold-start interview.
 *
 * Kept separate from the page because two screens now read it: the interview that writes it,
 * and the dashboard that reports whether it is still empty. A duplicated string literal in the
 * two would fail silently — the dashboard would keep saying "not configured" while the
 * interview reported saved — which is the failure mode `EDITABLE_STORAGE_KEYS` exists to
 * prevent elsewhere in this codebase. One module, one key.
 */

export const PRACTICE_PROFILE_KEY = 'slp_practice_profile'

/** Every field the interview asks for. Order is the interview's order. */
export const PRACTICE_PROFILE_FIELDS = [
  'role',
  'organisation',
  'jurisdictions',
  'riskPosture',
  'standardPositions',
  'approvals',
  'citationPosture',
] as const

export type PracticeProfileField = (typeof PRACTICE_PROFILE_FIELDS)[number]

export interface PracticeProfileRecord {
  role: string
  organisation: string
  jurisdictions: string
  riskPosture: string
  standardPositions: string
  approvals: string
  citationPosture: string
}

export const EMPTY_PROFILE: PracticeProfileRecord = {
  role: '',
  organisation: '',
  jurisdictions: '',
  riskPosture: '',
  standardPositions: '',
  approvals: '',
  citationPosture: '',
}

export function loadPracticeProfile(): PracticeProfileRecord {
  try {
    const raw = localStorage.getItem(PRACTICE_PROFILE_KEY)
    if (!raw) return EMPTY_PROFILE
    const parsed = JSON.parse(raw) as Partial<PracticeProfileRecord>
    return { ...EMPTY_PROFILE, ...parsed }
  } catch {
    // A corrupt profile is the same as no profile: skills fall back to generic output.
    return EMPTY_PROFILE
  }
}

/** How much of the interview is filled in, for the dashboard's readiness line. */
export function profileCompleteness(): { answered: number; total: number; complete: boolean } {
  const profile = loadPracticeProfile()
  const answered = PRACTICE_PROFILE_FIELDS.filter((field) => profile[field].trim().length > 0).length
  return {
    answered,
    total: PRACTICE_PROFILE_FIELDS.length,
    complete: answered === PRACTICE_PROFILE_FIELDS.length,
  }
}
