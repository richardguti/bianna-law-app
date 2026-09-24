import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { DocumentSubject, SessionMode } from '../types/database'
import { streamAi } from '../lib/aiStream'
import { loadDrills, saveDrills } from '../lib/courses'
import { EditableChipGroup } from '../components/EditableChipGroup'
import { EDITABLE_STORAGE_KEYS } from '../lib/editableFields'
import { ChatBubble } from '../components/ChatBubble'

type Message = { role: 'user' | 'assistant'; content: string; biaHtml?: string | null }

const SUBJECTS: { value: DocumentSubject; label: string }[] = [
  { value: 'contracts',      label: 'Contracts'   },
  { value: 'torts',          label: 'Torts'        },
  { value: 'civ_pro',        label: 'Civ Pro'      },
  { value: 'constitutional', label: 'Con Law'      },
  { value: 'property',       label: 'Property'     },
  { value: 'wills_trusts',   label: 'Wills & Trust'},
  { value: 'other',          label: 'Other'        },
]

const MODES: { value: SessionMode; label: string; icon: string }[] = [
  { value: 'socratic',   label: 'Socratic',   icon: 'psychology'    },
  { value: 'irac_full',  label: 'IRAC Full',  icon: 'article'       },
  { value: 'grade',      label: 'Grade Mode', icon: 'grading'       },
  { value: 'exam_prep',  label: 'Exam Prep',  icon: 'local_library' },
]

const QUICK_DRILLS: Record<DocumentSubject, string[]> = {
  contracts:      ['Offer & Acceptance', 'Consideration', 'Promissory Estoppel', 'UCC vs Common Law', 'Breach & Damages', 'Statute of Frauds'],
  torts:          ['Negligence Framework', 'Battery', 'Hand Formula', 'Products Liability', 'Strict Liability', 'Defenses'],
  civ_pro:        ['Int\'l Shoe', 'Twombly/Iqbal', 'Erie Doctrine', 'Personal Jurisdiction', 'SMJ & Diversity', 'Summary Judgment'],
  constitutional: ['Commerce Clause', 'Due Process', 'Equal Protection', 'First Amendment', 'Standing', 'Strict Scrutiny'],
  property:       ['Fee Simple Absolute', 'Life Estate', 'Adverse Possession', 'Easements', 'Rule Against Perpetuities', 'Landlord-Tenant'],
  wills_trusts:   ['Intestacy & Per Stirpes', 'Will Execution Formalities', 'Undue Influence', 'Lapse & Antilapse', 'Elective Share', 'Trustee Duties'],
  other:          [],
}

// `mode` is a string, not just SessionMode: the chip group allows the student to add a
// custom mode, and any unmapped value falls through to the full-IRAC instruction below.
function buildSystem(mode: string): string {
  const base = `You are the Senior Law Partner, a specialized AI legal study assistant for Bianna, a 1L at St. Thomas University School of Law in Miami, FL.

EXPERTISE: IRAC/CREAC methodology, Common Law vs. UCC Article 2, intentional torts, negligence (Hand Formula B < P × L), personal jurisdiction (minimum contacts), subject matter jurisdiction, and all standard 1L doctrine.

HALLUCINATION GUARD: Never fabricate case citations or holdings. If a doctrine is outside provided course materials, state: "Outside provided course materials — verify with professor."

TONE: Professional, high-stakes legal mentorship. You are a senior partner reviewing a junior associate's work.`

  if (mode === 'socratic')
    return base + '\n\nMODE: SOCRATIC. Present a 3-5 sentence fact pattern, then ask ONE targeted legal question. Wait for the student\'s answer before delivering the full IRAC analysis. Never give the answer upfront.'

  if (mode === 'grade')
    return base + '\n\nMODE: GRADE. When given a student IRAC answer, score each section 1-10 in this exact format:\n\nISSUE:      X/10\nRULE:       X/10\nANALYSIS:   X/10\nCONCLUSION: X/10\n\nMISSED: [strongest counterargument the student missed]\nHOOK:   [flag if this is a Professor Hook case]\n\nThen ask ONE Socratic follow-up question before revealing the corrected full answer.'

  if (mode === 'exam_prep')
    return base + '\n\nMODE: EXAM PREP. Focus exclusively on Professor Hook cases and high-frequency exam topics. Present only the most exam-critical fact patterns and doctrines.'

  return base + '\n\nMODE: IRAC FULL. Provide complete structured analysis with every response. Format each IRAC section with a clear labeled divider.'
}

export function StudySessions() {
  const apiKey = useAppStore((s) => s.apiKey)

  const [subject,        setSubject]        = useState<DocumentSubject>('contracts')
  // Free-text course name used when Subject is "Other", mirroring the Outline Generator.
  const [customSubject,  setCustomSubject]  = useState('')
  const [mode,           setMode]           = useState<string>('socratic')
  const [messages,       setMessages]       = useState<Message[]>([])
  const [drills,         setDrills]         = useState<string[]>(() => loadDrills('contracts', QUICK_DRILLS.contracts))
  const [editingDrills,  setEditingDrills]  = useState(false)
  const [drillDrafts,    setDrillDrafts]    = useState<Record<string, string>>({})

  useEffect(() => {
    setDrills(loadDrills(subject, QUICK_DRILLS[subject] ?? []))
    setEditingDrills(false)
    setDrillDrafts({})
  }, [subject])

  function updateDrill(index: number, value: string) {
    setDrillDrafts((d) => ({ ...d, [index]: value }))
  }
  function commitDrills() {
    const next = drills.map((d, i) => (drillDrafts[i]?.trim() ? drillDrafts[i].trim() : d)).filter(Boolean)
    setDrills(next)
    saveDrills(subject, next)
    setEditingDrills(false)
    setDrillDrafts({})
  }
  function removeDrill(index: number) {
    const next = drills.filter((_, i) => i !== index)
    setDrills(next)
    saveDrills(subject, next)
  }
  function addDrill() {
    const next = [...drills, 'New Drill']
    setDrills(next)
    saveDrills(subject, next)
    setEditingDrills(true)
  }
  const [input,          setInput]          = useState(() => {
    const captured = sessionStorage.getItem('capture_notes')
    if (captured) { sessionStorage.removeItem('capture_notes'); return captured }
    return ''
  })
  const [loading,  setLoading]  = useState(false)
  // ── Live stream state: answer tokens + R1's reasoning trace ──
  const [streamText, setStreamText] = useState('')
  const [reasoning,  setReasoning]  = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(prompt: string) {
    if (!prompt.trim() || loading || !apiKey) return
    const userMsg: Message = { role: 'user', content: prompt }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      let text = ''

      // Direct DeepSeek R1 API — streamed, so long answers type out live instead
      // of leaving the chat silent for 30-90 seconds.
      if (!text) {
        setStreamText('')
        setReasoning('')
        const outcome = await streamAi({
          messages: [
            { role: 'system', content: buildSystem(mode) },
            ...newMessages.map((m) => ({ role: m.role, content: m.content })),
          ],
          apiKey,
          maxTokens: 8192,
          onContent:   (delta) => setStreamText((prev) => prev + delta),
          onReasoning: (delta) => setReasoning((prev) => prev + delta),
        })
        if (outcome.error) throw new Error(outcome.error)
        text = outcome.content
        if (!text) throw new Error('Empty response — verify your DeepSeek API key in Settings.')
      }

      // Part 3: render the answer in the house four-tier language. Off the critical
      // path and failure-tolerant: if the formatter is unavailable the plain answer is
      // kept, so a formatting outage never costs her the response.
      let biaHtml: string | null = null
      try {
        const bia = await window.seniorPartner?.aiFormatBia?.({ text })
        if (bia?.success && bia.biaHtml) biaHtml = bia.biaHtml
      } catch { /* keep the plain answer */ }

      setMessages([...newMessages, { role: 'assistant', content: text, biaHtml }])
      setStreamText('')

      // Push Q&A to local study memory (fire-and-forget — never blocks UI)
      window.seniorPartner?.memoryWrite?.({
        content: `**Subject:** ${subject} | **Mode:** ${mode}\n\n**Q:** ${prompt}\n\n**A:** ${text.slice(0, 600)}${text.length > 600 ? '…' : ''}`,
        type:    'daily',
        heading: `Study Session — ${subject}`,
      })?.catch(() => { /* silent */ })

    } catch (err) {
      const msg = (err as Error).message
      const hint = msg === 'Failed to fetch'
        ? 'Network error — check your internet connection or browser shield settings.'
        : msg
      setMessages([...newMessages, { role: 'assistant', content: `⚠️ ${hint}` }])
      setStreamText('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — session config */}
      <aside className="w-72 shrink-0 bg-surface-container-low border-r border-outline-variant/10 flex flex-col p-6 gap-6 overflow-y-auto no-scrollbar">
        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-3">Subject</p>
          <EditableChipGroup
            presets={SUBJECTS.map((s) => (s.value === 'other' ? { value: 'other', label: customSubject.trim() || 'Other' } : s))}
            value={subject}
            persistValue
            onChange={(v) => {
              const val = String(v)
              const preset = SUBJECTS.find((s) => s.value === val)
              if (preset) {
                setSubject(preset.value)
              } else {
                setSubject('other')
                setCustomSubject(val)
              }
              setMessages([])
            }}
            storageKey={EDITABLE_STORAGE_KEYS.studySubject}
            columns={1}
            placeholder="e.g. Admiralty Law…"
          />
        </div>

        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-3">Mode</p>
          <EditableChipGroup
            presets={MODES.map((m) => ({ value: m.value, label: m.label, icon: m.icon }))}
            value={mode}
            onChange={(v) => { setMode(String(v)); setMessages([]) }}
            storageKey={EDITABLE_STORAGE_KEYS.studyMode}
            columns={1}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">Quick Drills</p>
            <button
              onClick={() => (editingDrills ? commitDrills() : setEditingDrills(true))}
              className="text-[10px] font-label uppercase tracking-widest text-primary hover:opacity-80 transition-opacity"
            >
              {editingDrills ? 'Done' : 'Edit drills'}
            </button>
          </div>
          <div className="space-y-1">
            {drills.map((drill, i) => (
              <div key={i} className="flex items-center gap-1 group">
                {editingDrills ? (
                  <input
                    value={drillDrafts[i] ?? drill}
                    onChange={(e) => updateDrill(i, e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md text-xs bg-surface-container-low border border-outline-variant/20 outline-none focus:border-primary"
                  />
                ) : (
                  <button
                    onClick={() => send(`Let's drill: ${drill}`)}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"
                  >
                    → {drill}
                  </button>
                )}
                {editingDrills && (
                  <button
                    onClick={() => removeDrill(i)}
                    title="Remove drill"
                    className="shrink-0 w-5 h-5 rounded-full text-[10px] text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {editingDrills && (
              <button
                onClick={addDrill}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                + Add drill
              </button>
            )}
          </div>
        </div>


        <button
          onClick={() => { setMessages([]); setLoading(false); setInput('') }}
          className="mt-auto py-2 px-4 rounded-full border border-outline-variant/40 text-xs font-label uppercase tracking-widest text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
        >
          New Session
        </button>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-container-lowest">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 mt-20 text-on-surface-variant">
              <span className="material-symbols-outlined text-5xl text-outline-variant">school</span>
              <p className="font-serif text-xl">Ready when you are, Partner.</p>
              <p className="text-sm text-center max-w-sm">
                Select a quick drill, paste a fact pattern, or ask any 1L doctrine question. In Grade mode, paste your IRAC answer for a 1-10 score on each section.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-2xl rounded-xl px-5 py-4 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-on-primary rounded-br-sm'
                    : 'bg-surface-container-low text-on-surface rounded-bl-sm border border-outline-variant/10'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <ChatBubble biaHtml={msg.biaHtml} plainText={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-2xl w-full space-y-3">
                {/* Live answer: tokens render as they stream in. */}
                {streamText ? (
                  <div className="bg-surface-container-low text-on-surface rounded-xl rounded-bl-sm border border-outline-variant/10 px-5 py-4">
                    <ChatBubble isStreaming streamingText={streamText} />
                  </div>
                ) : (
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-xl rounded-bl-sm px-5 py-4 flex gap-1.5 w-fit">
                    {[0, 150, 300].map((d) => (
                      <div key={d} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                )}
                {/* "Show your work": R1's chain-of-thought, streamed live. */}
                {reasoning && (
                  <details className="rounded-xl border border-outline-variant/20 bg-surface-container-low" open={!streamText}>
                    <summary className="cursor-pointer select-none px-4 py-2 text-[10px] font-label font-bold uppercase tracking-widest text-on-surface-variant">
                      DeepSeek&apos;s Legal Reasoning Trace
                    </summary>
                    <pre className="px-4 pb-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-on-surface-variant font-mono">
                      {reasoning}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-outline-variant/10 p-4 bg-surface-container-lowest">
          {!apiKey && (
            <p className="text-xs text-error mb-2 text-center">Add your DeepSeek API key in Settings to start a session.</p>
          )}
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
              placeholder={mode === 'grade' ? 'Paste your IRAC answer here for grading…' : 'Ask a legal question or describe a fact pattern…'}
              rows={3}
              disabled={!apiKey || loading}
              className="flex-1 bg-surface-container-low border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-xl px-4 py-3 text-sm outline-none resize-none transition-all disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading || !apiKey}
              className="self-end py-3 px-5 bg-primary text-on-primary rounded-full font-label text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      </div>


    </div>
  )
}
