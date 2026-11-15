import { useMemo, useState } from 'react'
import { LIVE_AREAS } from '../lib/practiceAreas'
import {
  EMPTY_PROFILE as EMPTY,
  PRACTICE_PROFILE_FIELDS as FIELDS,
  PRACTICE_PROFILE_KEY as PROFILE_KEY,
  loadPracticeProfile as loadProfile,
  type PracticeProfileRecord,
} from '../lib/practiceProfile'

/**
 * PracticeProfile — the cold-start interview.
 *
 * Anthropic's own setup guide names this as the single most common reason a plugin returns
 * generic output, and the reason is structural rather than technical: a skill can only be as
 * specific as the profile it reads from. A playbook is not a market standard, it is *this*
 * team's standard, and nothing infers it from an empty form.
 *
 * The interview is therefore five questions, not one box, and it is explicit that skipping it
 * is allowed — the skills still run, they just run generically. Hiding that choice is what
 * produces the complaint the form exists to prevent.
 *
 * Stored in localStorage under a namespaced key, following the app's existing convention for
 * renderer-owned state. It is read by every screen that needs to know what "our standard"
 * means, and it survives restarts, which is the only property that makes it a profile rather
 * than a prompt.
 */

/** Alias kept so the page reads as it did; the record itself lives in lib/practiceProfile. */
type PracticeProfileDraft = PracticeProfileRecord

const ROLE_OPTIONS = [
  'Commercial counsel',
  'Litigation',
  'Privacy',
  'AI governance',
  'Product counsel',
  'Law student',
  'Clinic / pro bono',
]

const RISK_OPTIONS = [
  {
    id: 'conservative',
    label: 'Conservative',
    detail: 'Prefer the standard position even where it costs the deal. Escalate early.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    detail: 'Accept a documented fallback rung when the commercial case is made.',
  },
  {
    id: 'aggressive',
    label: 'Commercially led',
    detail: 'Accept deviation where the risk is capped and the owner signs off.',
  },
]

const CITATION_OPTIONS = [
  {
    id: 'strict',
    label: 'Every finding must be anchored',
    detail: 'An unanchored claim is reported as unverified and cannot support a conclusion.',
  },
  {
    id: 'practical',
    label: 'Anchor where the source is held',
    detail: 'Unanchored findings are allowed but flagged, and never counted as verified.',
  },
]

export function PracticeProfile() {
  const [draft, setDraft] = useState<PracticeProfileDraft>(loadProfile)
  const [savedAt, setSavedAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`${PROFILE_KEY}_saved`)
    } catch {
      return null
    }
  })
  const [notice, setNotice] = useState<string | null>(null)

  const answered = useMemo(
    () => FIELDS.filter((field) => draft[field].trim().length > 0).length,
    [draft],
  )
  const complete = answered === FIELDS.length

  function set<K extends keyof PracticeProfileDraft>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setNotice(null)
  }

  function save() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(draft))
      const stamp = new Date().toLocaleString()
      localStorage.setItem(`${PROFILE_KEY}_saved`, stamp)
      setSavedAt(stamp)
      setNotice('Profile saved. Every skill now reads from it.')
    } catch {
      setNotice('Could not write to local storage — the profile is live but will not persist.')
    }
  }

  function clear() {
    try {
      localStorage.removeItem(PROFILE_KEY)
      localStorage.removeItem(`${PROFILE_KEY}_saved`)
    } catch {
      /* clearing is best-effort; the in-memory reset below still applies */
    }
    setDraft(EMPTY)
    setSavedAt(null)
    setNotice('Profile cleared. Skills will run generically until it is rebuilt.')
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">Practice profile · Cold start</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          One interview, read by every skill
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
          Skipping this is the single most common reason a skill returns generic output. Ten to
          twenty minutes here calibrates all {LIVE_AREAS.length} live practice areas; without it
          they still run, but they run as though the team had no positions at all.
        </p>
      </header>

      {/* ── Status ───────────────────────────────────────────────────────── */}
      <div className="border border-outline-variant bg-surface p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1">
          <p className="label-micro">{complete ? 'Profile in force' : 'Incomplete'}</p>
          <p className="font-serif text-xl text-on-surface mt-1">
            {answered} of {FIELDS.length} answered
          </p>
        </div>
        <div className="flex-1">
          <div className="h-1 bg-surface-container-high">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(answered / FIELDS.length) * 100}%` }}
            />
          </div>
          <p className="citation mt-2">
            {savedAt ? `Last saved ${savedAt}` : 'Never saved'}
          </p>
        </div>
      </div>

      {notice && (
        <p className="text-sm text-on-surface-variant border-l-2 border-accent pl-3 leading-snug">
          {notice}
        </p>
      )}

      {/* ── 1. Role ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">01</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">Which area do you sit in?</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => set('role', role)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                draft.role === role
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      </section>

      {/* ── 2. Organisation ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">02</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">
            Who do you act for, and where?
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="profile-org"
              className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2"
            >
              Organisation
            </label>
            <input
              id="profile-org"
              value={draft.organisation}
              onChange={(e) => set('organisation', e.target.value)}
              placeholder="In-house team, firm, or clinic"
              className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
            />
          </div>
          <div>
            <label
              htmlFor="profile-jur"
              className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2"
            >
              Jurisdictions that matter
            </label>
            <input
              id="profile-jur"
              value={draft.jurisdictions}
              onChange={(e) => set('jurisdictions', e.target.value)}
              placeholder="Florida, New York, EU"
              className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
            />
          </div>
        </div>
      </section>

      {/* ── 3. Risk posture ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">03</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">How much risk is acceptable?</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
          {RISK_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => set('riskPosture', option.id)}
              className={`text-left p-5 transition-colors ${
                draft.riskPosture === option.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface hover:bg-surface-container-lowest'
              }`}
            >
              <p className="font-serif text-lg leading-tight">{option.label}</p>
              <p
                className={`text-[13px] leading-snug mt-2 ${
                  draft.riskPosture === option.id
                    ? 'text-on-primary/75'
                    : 'text-on-surface-variant'
                }`}
              >
                {option.detail}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── 4. Standard positions ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">04</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">
            What does your team actually sign?
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed max-w-2xl">
          Not the market position — yours. Liability cap, governing law, indemnity, termination.
          One line per position is enough; this is the text the deviation board compares against.
        </p>
        <textarea
          value={draft.standardPositions}
          onChange={(e) => set('standardPositions', e.target.value)}
          rows={5}
          placeholder={'Liability: 12 months of fees, mutual.\nGoverning law: Florida.\nIndemnity: vendor defends IP claims.'}
          className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all resize-none"
        />
      </section>

      {/* ── 5. Approvals ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">05</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">Who approves an exception?</h2>
        </div>
        <textarea
          value={draft.approvals}
          onChange={(e) => set('approvals', e.target.value)}
          rows={3}
          placeholder={'Cap above 18 months → Head of Commercial.\nUncapped liability → General Counsel.'}
          className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all resize-none"
        />
      </section>

      {/* ── 6. Citation posture ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="border-b border-outline-variant pb-2">
          <p className="label-micro">06</p>
          <h2 className="font-serif text-2xl text-on-surface mt-1">How strict on citation?</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant border border-outline-variant">
          {CITATION_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => set('citationPosture', option.id)}
              className={`text-left p-5 transition-colors ${
                draft.citationPosture === option.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface hover:bg-surface-container-lowest'
              }`}
            >
              <p className="font-serif text-lg leading-tight">{option.label}</p>
              <p
                className={`text-[13px] leading-snug mt-2 ${
                  draft.citationPosture === option.id
                    ? 'text-on-primary/75'
                    : 'text-on-surface-variant'
                }`}
              >
                {option.detail}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 border-t border-outline-variant pt-6">
        <button
          type="button"
          onClick={save}
          className="px-6 py-3 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity"
        >
          Save profile
        </button>
        <button
          type="button"
          onClick={clear}
          className="px-6 py-3 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors"
        >
          Clear
        </button>
        <p className="text-[13px] text-on-surface-variant self-center leading-snug sm:ml-2">
          Holding on to this is optional. The skills will run without it.
        </p>
      </div>
    </div>
  )
}
