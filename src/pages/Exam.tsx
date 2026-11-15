import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Exam Question Mode — a run of questions, not a single quiz.
 *
 * The shape follows the pattern of a commercial bar-prep drill: a progress rail with `n / total`,
 * a running ✗/✓ tally, the question, the options, and a hint that is available before you answer
 * rather than after. What it adds is the chain: a run of 25 can be extended by another 25 in the
 * same domain, and the tally carries forward, so the session behaves like one long sitting instead
 * of a series of disconnected quizzes.
 *
 * Grading is honest about what it can and cannot do. Multiple choice is graded exactly. Written and
 * essay answers are shown against a model answer and a rubric, and the student marks their own —
 * labelling that as self-assessment rather than pretending a lexical check is a professor.
 */

type DomainId = 'property' | 'contracts' | 'constitutional' | 'torts' | 'criminal'
type ExamKind = 'mcq' | 'written' | 'essay'
type Difficulty = 'foundational' | 'midterm' | 'exam'

interface ExamQuestion {
  id: string
  kind: ExamKind
  prompt: string
  options?: string[]
  answerIndex?: number
  modelAnswer?: string
  rubric?: string[]
  hint: string
  rationale: string
  doctrine: string
  /** Which subject produced this item — the unit analytics are reported in. */
  subject?: string
}

interface Answer {
  pickedIndex?: number
  text?: string
  correct?: boolean
  revealed: boolean
}

interface Session {
  id: string
  domain: DomainId
  kind: ExamKind
  difficulty: Difficulty
  questions: ExamQuestion[]
  answers: Record<string, Answer>
  cursor: number
  createdAt: string
  /** Set when the run was built from a typed topic rather than a practice area. */
  topic?: string
  allSources?: boolean
  mode?: Mode
  subject?: string
  part?: 'A' | 'B' | 'both'
  startedAt?: string
  finishedAt?: string
  /** Which corpus sources the questions were grounded in. */
  sources?: string[]
  label?: string
}

const DOMAINS: Array<{ id: DomainId; label: string }> = [
  { id: 'contracts', label: 'Contracts' },
  { id: 'torts', label: 'Torts' },
  { id: 'property', label: 'Property' },
  { id: 'constitutional', label: 'Constitutional' },
  { id: 'criminal', label: 'Criminal Procedure' },
]

const KINDS: Array<{ id: ExamKind; label: string; blurb: string }> = [
  { id: 'mcq', label: 'Multiple choice', blurb: 'Four options, one best answer, graded exactly.' },
  { id: 'written', label: 'Written', blurb: 'Short answer with a model response.' },
  { id: 'essay', label: 'Essay', blurb: 'Issue-spotting prompt with a scoring rubric.' },
]

const DIFFICULTIES: Array<{ id: Difficulty; label: string }> = [
  { id: 'foundational', label: 'Foundational' },
  { id: 'midterm', label: 'Midterm' },
  { id: 'exam', label: 'Exam' },
]

const STORAGE_KEY = 'slp_exam_session'
const STATS_KEY = 'slp_exam_stats'

/** mm:ss, or h:mm:ss past an hour — a Part A sitting runs three hours. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

interface SubjectStat {
  attempted: number
  correct: number
}

/** Lifetime record by subject, so a run can be read against everything before it. */
function loadStats(): Record<string, SubjectStat> {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, SubjectStat>) : {}
  } catch {
    return {}
  }
}
const LETTERS = ['A', 'B', 'C', 'D']

type Mode = 'bar' | 'final'

/**
 * Two law exam modes.
 *
 * `bar` is the Florida examination: the Board's sixteen subjects, answered under Florida law where
 * it diverges from the general law, grounded in its published specifications and study guides.
 * `final` is a law-school final — any course, any shelf.
 */
const MODES: Array<{ id: Mode; label: string; blurb: string }> = [
  { id: 'bar', label: 'Bar Examination', blurb: 'The Board’s sixteen subjects, answered under Florida law.' },
  { id: 'final', label: 'Final Exam', blurb: 'A course or topic from any law shelf — the usual essay, short answer or multiple choice.' },
]
/** The sixteen subjects the Florida Board of Bar Examiners publishes test specifications for. */
const MBE_SUBJECTS = [
  'Civil Procedure (MBE)',
  'Constitutional Law (MBE)',
  'Contracts and Sales (MBE)',
  'Criminal Law and Procedure (MBE)',
  'Evidence (MBE)',
  'Real Property (MBE)',
  'Torts (MBE)',
]

const FL_SUBJECTS = [
  'Business Entities',
  'Chapters 4 & 5 of the Rules Regulating The Florida Bar',
  'Contracts',
  'Criminal Law and Constitutional Criminal Procedure',
  'Evidence',
  'Family Law',
  'Federal Constitutional Law',
  'Florida Constitutional Law',
  'Florida Rules of Civil Procedure',
  'Florida Rules of Criminal Procedure',
  'Florida Rules of Judicial Administration',
  'Professionalism',
  'Real Property',
  'Torts',
  'Uniform Commercial Code, Articles 3 and 9',
  'Wills & Trusts',
]

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    return parsed && Array.isArray(parsed.questions) ? parsed : null
  } catch {
    return null
  }
}

export function Exam() {
  const [domain, setDomain] = useState<DomainId>('contracts')
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<Mode>('bar')
  const [subject, setSubject] = useState('')
  const [part, setPart] = useState<'A' | 'B' | 'both'>('A')
  const [stats, setStats] = useState<Record<string, SubjectStat>>(loadStats)
  const [clock, setClock] = useState(() => Date.now())
  const [kind, setKind] = useState<ExamKind>('mcq')
  const [difficulty, setDifficulty] = useState<Difficulty>('midterm')
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hintOpen, setHintOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const topRef = useRef<HTMLDivElement | null>(null)

  /**
   * A stored run is offered, not entered.
   *
   * The page used to restore the last session on mount, so clicking "Exam Questions" dropped the
   * student into question 3 of a run they had forgotten about, with no way back to the discipline
   * picker in sight. Landing on the setup screen and offering to resume is the behaviour the nav
   * item implies.
   */
  const [session, setSession] = useState<Session | null>(null)
  const [resumable, setResumable] = useState<Session | null>(() => loadSession())

  useEffect(() => {
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    } catch {
      /* persistence is a convenience; the run still works in memory */
    }
  }, [session])

  // The clock runs while a session is open; a part A sitting is three hours and the candidate needs
  // to see time pass.
  useEffect(() => {
    if (!session || session.cursor >= session.questions.length) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [session])

  const elapsed = session?.startedAt ? clock - Date.parse(session.startedAt) : 0

  const current = session ? session.questions[session.cursor] : null
  const answer = current && session ? session.answers[current.id] : undefined

  const tally = useMemo(() => {
    if (!session) return { right: 0, wrong: 0, answered: 0 }
    let right = 0
    let wrong = 0
    for (const entry of Object.values(session.answers)) {
      if (entry.correct === true) right += 1
      else if (entry.correct === false) wrong += 1
    }
    return { right, wrong, answered: right + wrong }
  }, [session])

  const generate = useCallback(
    async (target: {
      domain: DomainId
      kind: ExamKind
      difficulty: Difficulty
      count: number
      topic?: string
      allSources?: boolean
      mode?: Mode
      part?: 'A' | 'B' | 'both'
      subject?: string
    }) => {
      setBusy(true)
      setError(null)
      try {
        const runMode: Mode = target.mode ?? 'bar'
        const runPart = target.part ?? 'A'
        const useTopic = Boolean(target.topic && target.topic.trim())
        const result = await window.seniorPartner?.examGenerate?.({
          mode: runMode,
          // A typed topic overrides the shelf: `allSources` makes the main process query every
          // domain and merge the results instead of searching one pool.
          domain: !useTopic && !target.subject ? target.domain : undefined,
          topic: useTopic ? target.topic?.trim() : undefined,
          allSources: useTopic,
          subject: target.subject,
          part: target.part,
          kind: target.kind,
          difficulty: target.difficulty,
          count: target.count,
        })
        if (!result?.success || !result.questions?.length) {
          setError(result?.error || 'No questions came back. Try again.')
          return
        }
        const questions = result.questions as ExamQuestion[]
        const nextTopic = result.topic ?? undefined
        const nextSubject = result.subject ?? undefined
        setSession((previous) => {
          // Continuing a chain appends; starting fresh replaces. The scope must match too, or a
          // topic run would silently continue as a practice-area run.
          const keep =
            previous &&
            previous.domain === target.domain &&
            previous.kind === target.kind &&
            previous.mode === runMode &&
            (previous.topic ?? '') === (nextTopic ?? '') &&
            (previous.subject ?? '') === (nextSubject ?? '')
          return {
            id: previous?.id ?? crypto.randomUUID(),
            domain: target.domain,
            kind: target.kind,
            difficulty: target.difficulty,
            questions: keep ? [...previous.questions, ...questions] : questions,
            answers: keep ? previous.answers : {},
            cursor: keep ? previous.questions.length : 0,
            createdAt: previous?.createdAt ?? new Date().toISOString(),
            mode: runMode,
            part: runPart,
            startedAt: keep ? previous.startedAt : new Date().toISOString(),
            subject: nextSubject,

            topic: nextTopic,
            allSources: result.allSources,
            sources: result.sources ?? [],
            label: result.label,
          }
        })
        setDraft('')
        setHintOpen(false)
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Question generation failed.')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  function start() {
    // Beginning a new exam discards the stored run: "start" and "resume" must not both be live.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setResumable(null)
    void generate({
      domain,
      kind,
      difficulty,
      count,
      mode,
      part,
      // A named Bar subject takes precedence over the practice area and over a typed topic, because
      // the Board tests that subject's own rules.
      subject: subject || undefined,
      topic: subject ? undefined : topic,
    })
  }

  function continueChain() {
    if (!session) return
    void generate({
      domain: session.domain,
      kind: session.kind,
      difficulty: session.difficulty,
      count: Math.min(25, session.questions.length),
      // Keep the same scope: a topic run must continue as a topic run, not fall back to a shelf.
      mode: session.mode,
      part: session.part,
      topic: session.topic,
      subject: session.subject,
      allSources: session.allSources,
    })
  }

  /** Fold one answer into the lifetime record, keyed by subject. */
  function recordStat(label: string | undefined, correct: boolean) {
    const key = label || 'General'
    setStats((previous) => {
      const current = previous[key] || { attempted: 0, correct: 0 }
      const next = {
        ...previous,
        [key]: { attempted: current.attempted + 1, correct: current.correct + (correct ? 1 : 0) },
      }
      try {
        localStorage.setItem(STATS_KEY, JSON.stringify(next))
      } catch {
        /* the record is a convenience; the run still works */
      }
      return next
    })
  }

  function reveal() {
    if (!session || !current) return
    if (current.kind === 'mcq') recordStat(current.subject, answer?.pickedIndex === current.answerIndex)
    setSession((previous) => {
      if (!previous) return previous
      const existing = previous.answers[current.id]
      const next: Answer =
        current.kind === 'mcq'
          ? {
              pickedIndex: existing?.pickedIndex,
              revealed: true,
              correct: existing?.pickedIndex === current.answerIndex,
            }
          : { text: existing?.text ?? draft, revealed: true, correct: existing?.correct }
      return { ...previous, answers: { ...previous.answers, [current.id]: next } }
    })
  }

  function pick(index: number) {
    if (!session || !current || answer?.revealed) return
    setSession((previous) =>
      previous
        ? {
            ...previous,
            answers: { ...previous.answers, [current.id]: { pickedIndex: index, revealed: false } },
          }
        : previous,
    )
  }

  function selfGrade(correct: boolean) {
    if (!session || !current) return
    setSession((previous) =>
      previous
        ? {
            ...previous,
            answers: { ...previous.answers, [current.id]: { text: draft, revealed: true, correct } },
          }
        : previous,
    )
  }

  function advance() {
    if (!session) return
    setDraft('')
    setHintOpen(false)
    setSession((previous) =>
      previous
        ? {
            ...previous,
            cursor: Math.min(previous.cursor + 1, previous.questions.length),
            finishedAt:
              previous.cursor + 1 >= previous.questions.length
                ? new Date().toISOString()
                : previous.finishedAt,
          }
        : previous,
    )
  }

  function finish() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setSession(null)
    setResumable(null)
    setDraft('')
    setHintOpen(false)
    setError(null)
  }

  // ── Setup screen ────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-8">
        <header className="border-b border-outline-variant pb-6">
          <p className="label-micro">Exam Question Mode</p>
          <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
            Sit an exam, then extend it
          </h1>
          <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
            Questions are written from the passages this app actually holds for the practice area you
            pick. Reach the end of a run and you can add another run in the same domain — the tally
            continues across the whole sitting.
          </p>
        </header>

        <section className="space-y-5">
          {/* A stored run is offered here rather than entered automatically. */}
          {resumable && resumable.questions.length > 0 && (
            <div className="border border-outline-variant bg-surface p-5 flex flex-wrap items-center gap-4">
              <div className="min-w-0">
                <p className="label-micro">Unfinished run</p>
                <p className="font-serif text-lg text-on-surface mt-1">
                  {DOMAINS.find((entry) => entry.id === resumable.domain)?.label} · question{' '}
                  {Math.min(resumable.cursor + 1, resumable.questions.length)} of{' '}
                  {resumable.questions.length}
                </p>
                <p className="citation mt-1">
                  {Object.values(resumable.answers).filter((a) => a.revealed).length} answered
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSession(resumable)
                    setResumable(null)
                  }}
                  className="px-4 py-2 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity"
                >
                  Resume →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.removeItem(STORAGE_KEY)
                    } catch {
                      /* ignore */
                    }
                    setResumable(null)
                  }}
                  className="px-4 py-2 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Mode */}
          <div>
            <p className="label-micro mb-2">Exam mode</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-outline-variant border border-outline-variant">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setMode(option.id)
                    if (option.id === 'final') setSubject('')
                  }}
                  className={`text-left p-4 transition-colors ${
                    mode === option.id
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface hover:bg-surface-container-lowest'
                  }`}
                >
                  <p className="font-serif text-lg leading-tight">{option.label}</p>
                  <p
                    className={`text-[13px] leading-snug mt-1.5 ${
                      mode === option.id ? 'text-on-primary/75' : 'text-on-surface-variant'
                    }`}
                  >
                    {option.blurb}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div>
            {mode === 'bar' && (
              <>
                <p className="label-micro mb-2">Florida Bar subject</p>
                <select
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value)
                    if (event.target.value) setTopic('')
                  }}
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
                >
                  <option value="">— none: use a practice area or a typed topic —</option>
                  <optgroup label="Part A — Florida law">
                    {FL_SUBJECTS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Part B — Multistate (national law)">
                    {MBE_SUBJECTS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </optgroup>
                </select>

                <p className="label-micro mb-2 mt-4">Part</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'A' as const, label: 'Part A — Florida' },
                    { id: 'B' as const, label: 'Part B — Multistate' },
                    { id: 'both' as const, label: 'Both (50/50)' },
                  ]).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setPart(option.id)}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                        part === option.id
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p className="label-micro mb-2 mt-4">Practice area</p>
            <div className="flex flex-wrap gap-2">
              {DOMAINS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setDomain(option.id)
                    // Choosing a shelf clears the other selectors, so scope never contradicts itself.
                    setTopic('')
                    setSubject('')
                  }}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    !topic.trim() && !subject && domain === option.id
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <label htmlFor="exam-topic" className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">
                Or type a topic — searches every shelf
              </label>
              <input
                id="exam-topic"
                value={topic}
                onChange={(event) => {
                  setTopic(event.target.value)
                  if (event.target.value) setSubject('')
                }}
                placeholder="e.g. Fourth Amendment vehicle stops, UCC 2-207, promissory estoppel"
                className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
              />
              <p className="text-[12px] text-on-surface-variant leading-snug mt-1.5">
                {subject
                  ? `Florida Bar subject selected: ${subject}. Questions are answered under Florida law where it diverges from the general law.`
                  : topic.trim()
                    ? `Every shelf will be searched for “${topic.trim()}”, and each item must survive the item-quality review before you see it.`
                    : 'Leave it blank to study a practice area as a whole. Every item is reviewed for a single defensible answer, real distractors and a stem that does not name the doctrine.'}
              </p>
            </div>
          </div>

          <div>
            <p className="label-micro mb-2">Question type</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-outline-variant border border-outline-variant">
              {KINDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setKind(option.id)}
                  className={`text-left p-4 transition-colors ${
                    kind === option.id ? 'bg-primary text-on-primary' : 'bg-surface hover:bg-surface-container-lowest'
                  }`}
                >
                  <p className="font-serif text-lg leading-tight">{option.label}</p>
                  <p className={`text-[13px] leading-snug mt-1.5 ${kind === option.id ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>
                    {option.blurb}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <div>
              <p className="label-micro mb-2">Difficulty</p>
              <div className="flex gap-2">
                {DIFFICULTIES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setDifficulty(option.id)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                      difficulty === option.id
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2">
              <span className="label-micro">Questions</span>
              <input
                type="number"
                min={5}
                max={25}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                className="w-20 bg-surface-container-lowest border border-outline-variant/20 focus:border-primary rounded-lg px-3 py-2 text-sm outline-none"
              />
            </label>

            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="ml-auto px-6 py-3 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {busy ? 'Writing questions…' : 'Begin →'}
            </button>
          </div>

          {error && (
            <p className="text-sm text-on-surface-variant border-l-2 border-accent pl-3 leading-snug">
              {error}
            </p>
          )}
        </section>
      </div>
    )
  }

  // ── Finished ────────────────────────────────────────────────────────────
  const finished = session.cursor >= session.questions.length
  if (finished) {
    const total = session.questions.length
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-6">
        <header className="border-b border-outline-variant pb-5">
          <p className="label-micro">Run complete</p>
          <h1 className="text-4xl font-serif mt-2 text-on-surface">
            {tally.right} right · {tally.wrong} wrong
          </h1>
          <p className="text-[15px] text-on-surface-variant mt-2">
            {tally.answered} of {total} answered in {DOMAINS.find((d) => d.id === session.domain)?.label}.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void continueChain()}
            disabled={busy}
            className="px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {busy ? 'Writing more…' : `Add ${Math.min(25, total)} more`}
          </button>
          <button
            type="button"
            onClick={finish}
            className="px-5 py-2.5 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors"
          >
            Start a new exam
          </button>
        </div>

        {error && (
          <p className="text-sm text-on-surface-variant border-l-2 border-accent pl-3 leading-snug">{error}</p>
        )}

        {session.sources && session.sources.length > 0 && (
          <p className="citation leading-relaxed">
            Built from {session.sources.join(' · ')}
          </p>
        )}

        {/* Per-subject analytics: a total score says how you did, not what to revise. */}
        <section className="space-y-3">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">Where the misses were</h2>
            <p className="label-micro">this run · lifetime</p>
          </div>

          {(() => {
            const bySubject = new Map<string, { attempted: number; correct: number }>()
            for (const question of session.questions) {
              const entry = session.answers[question.id]
              if (!entry || entry.correct === undefined) continue
              const key = question.subject || session.label || 'General'
              const current = bySubject.get(key) || { attempted: 0, correct: 0 }
              bySubject.set(key, {
                attempted: current.attempted + 1,
                correct: current.correct + (entry.correct ? 1 : 0),
              })
            }
            if (!bySubject.size) return <p className="text-[13px] text-on-surface-variant">No graded answers in this run.</p>
            return [...bySubject.entries()].map(([subject, run]) => {
              const lifetime = stats[subject]
              const share = run.attempted ? Math.round((run.correct / run.attempted) * 100) : 0
              return (
                <div key={subject} className="flex items-center gap-3">
                  <span className="text-[13px] text-on-surface w-52 shrink-0 truncate">{subject}</span>
                  <div className="h-2 flex-1 bg-surface-container-high">
                    <div className="h-2 bg-primary" style={{ width: `${share}%` }} />
                  </div>
                  <span className="citation shrink-0">{run.correct}/{run.attempted}</span>
                  <span className="citation shrink-0 text-on-surface-variant w-24 text-right">
                    {lifetime ? `all-time ${lifetime.correct}/${lifetime.attempted}` : ''}
                  </span>
                </div>
              )
            })
          })()}

          {session.startedAt && (
            <p className="citation">Time on this run: {formatDuration((session.finishedAt ? Date.parse(session.finishedAt) : Date.now()) - Date.parse(session.startedAt))}</p>
          )}
        </section>
        <section className="space-y-2">
          <p className="label-micro">Review</p>
          {session.questions.map((question, index) => {
            const entry = session.answers[question.id]
            return (
              <div key={question.id} className="border border-outline-variant bg-surface px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="citation shrink-0">{index + 1}.</span>
                  <p className="text-[13px] text-on-surface leading-snug flex-1">{question.prompt}</p>
                  <span
                    className={`citation shrink-0 ${
                      entry?.correct === true
                        ? 'text-verdict-green'
                        : entry?.correct === false
                          ? 'text-verdict-red'
                          : 'text-on-surface-variant'
                    }`}
                  >
                    {entry?.correct === true ? '✓' : entry?.correct === false ? '✗' : '—'}
                  </span>
                </div>
              </div>
            )
          })}
        </section>
      </div>
    )
  }

  // ── Question ────────────────────────────────────────────────────────────
  const progress = Math.round((session.cursor / session.questions.length) * 100)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6" ref={topRef}>
      {/* Rail */}
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-outline-variant relative">
          <div className="absolute inset-y-0 left-0 bg-on-surface" style={{ width: `${progress}%` }} />
        </div>
        <span className="citation shrink-0">
          {session.cursor + 1} / {session.questions.length}
        </span>
        <span className="citation shrink-0 text-verdict-red">✗ {tally.wrong}</span>
        <span className="citation shrink-0 text-verdict-green">✓ {tally.right}</span>
        <span className="citation shrink-0">{formatDuration(elapsed)}</span>
      </div>

      {/* What the questions were built from — a typed topic spans several shelves, so say which. */}
      {session.sources && session.sources.length > 0 && (
        <p className="citation leading-relaxed">
          {session.topic ? `“${session.topic}” · ` : ''}
          Grounded in {session.sources.slice(0, 3).join(' · ')}
          {session.sources.length > 3 ? ` +${session.sources.length - 3} more` : ''}
        </p>
      )}

      <div className="border border-outline-variant bg-surface">
        <div className="px-6 py-4 border-b border-outline-variant flex flex-wrap items-center gap-2">
          <span className="label-micro">Question {session.cursor + 1}</span>
          <span className="citation ml-auto">
            {session.kind === 'mcq' ? 'Multiple choice' : session.kind === 'written' ? 'Written' : 'Essay'} ·{' '}
            {session.difficulty}
          </span>
          <button
            type="button"
            onClick={finish}
            className="citation underline hover:text-on-surface transition-colors"
          >
            New exam
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <p className="text-[15px] leading-relaxed text-on-surface">{current?.prompt}</p>

          {/* MCQ options */}
          {current?.kind === 'mcq' && (
            <div className="space-y-2">
              {(current.options ?? []).map((option, index) => {
                const picked = answer?.pickedIndex === index
                const isCorrect = current.answerIndex === index
                const show = answer?.revealed
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => pick(index)}
                    disabled={answer?.revealed}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border transition-colors ${
                      show && isCorrect
                        ? 'border-verdict-green bg-verdict-green-soft'
                        : show && picked && !isCorrect
                          ? 'border-verdict-red bg-verdict-red-soft'
                          : picked
                            ? 'border-on-surface bg-surface-container-low'
                            : 'border-outline-variant hover:border-primary/40'
                    }`}
                  >
                    <span className="citation shrink-0 pt-0.5">{LETTERS[index]}.</span>
                    <span className="text-sm text-on-surface leading-snug">{option}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Written / essay */}
          {current && current.kind !== 'mcq' && (
            <div className="space-y-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={8}
                disabled={answer?.revealed}
                placeholder="Write your answer…"
                className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all resize-none disabled:opacity-60"
              />
              {answer?.revealed && (
                <div className="space-y-3 border-t border-outline-variant pt-3">
                  <div>
                    <p className="label-micro">Model answer</p>
                    <p className="text-[13px] text-on-surface leading-relaxed mt-1">
                      {current.modelAnswer}
                    </p>
                  </div>
                  {current.rubric && current.rubric.length > 0 && (
                    <div>
                      <p className="label-micro">Rubric</p>
                      <ul className="mt-1 space-y-1">
                        {current.rubric.map((item) => (
                          <li key={item} className="text-[13px] text-on-surface-variant leading-snug">
                            — {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {answer.correct === undefined && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => selfGrade(true)}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-verdict-green-soft text-verdict-green"
                      >
                        I covered this
                      </button>
                      <button
                        type="button"
                        onClick={() => selfGrade(false)}
                        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-verdict-red-soft text-verdict-red"
                      >
                        I missed this
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hint */}
          <div>
            <button
              type="button"
              onClick={() => setHintOpen((open) => !open)}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Hint
              <span className="material-symbols-outlined text-sm">
                {hintOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {hintOpen && (
              <p className="text-[13px] text-on-surface-variant leading-relaxed mt-1.5 border-l-2 border-outline-variant pl-3">
                {current?.hint || 'No hint was written for this question.'}
              </p>
            )}
          </div>

          {/* Feedback */}
          {answer?.revealed && (
            <div className="border-t border-outline-variant pt-3 space-y-2">
              <p className="label-micro">
                {current?.kind === 'mcq'
                  ? answer.correct
                    ? 'Correct'
                    : `Incorrect — the answer was ${LETTERS[current.answerIndex ?? 0]}`
                  : 'Compare with the model answer'}
              </p>
              <p className="text-[13px] text-on-surface leading-relaxed">{current?.rationale}</p>
              {current?.doctrine && <p className="citation">{current.doctrine}</p>}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant bg-surface-container-low flex items-center gap-2">
          <button
            type="button"
            onClick={finish}
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
          >
            End run
          </button>
          <div className="ml-auto flex gap-2">
            {!answer?.revealed ? (
              <button
                type="button"
                onClick={reveal}
                disabled={current?.kind === 'mcq' ? answer?.pickedIndex === undefined : !draft.trim()}
                className="px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Check answer
              </button>
            ) : (
              <button
                type="button"
                onClick={advance}
                className="px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-on-surface-variant border-l-2 border-accent pl-3 leading-snug">{error}</p>
      )}
    </div>
  )
}
