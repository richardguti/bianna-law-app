import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { DocumentSubject, SessionMode } from '../types/database'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'

declare global {
  interface Window {
    seniorPartner?: {
      openClawStatus: () => Promise<{ installed: boolean; running: boolean }>
      openClawChat:         (args: { messages: { role: string; content: string }[]; system: string }) => Promise<{ success: boolean; response?: string; error?: string }>
      openClawMemoryWrite:  (args: { content: string; type?: string; heading?: string }) => Promise<{ success: boolean }>
      [key: string]: unknown
    }
  }
}

type Message = { role: 'user' | 'assistant'; content: string }

const SUBJECTS: { value: DocumentSubject; label: string }[] = [
  { value: 'contracts',      label: 'Contracts'   },
  { value: 'torts',          label: 'Torts'        },
  { value: 'civ_pro',        label: 'Civ Pro'      },
  { value: 'constitutional', label: 'Con Law'      },
  { value: 'property',       label: 'Property'     },
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
  other:          [],
}

function buildSystem(mode: SessionMode): string {
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
  const [mode,           setMode]           = useState<SessionMode>('socratic')
  const [messages,       setMessages]       = useState<Message[]>([])
  const [useOpenClaw,    setUseOpenClaw]    = useState(false)
  const [ocAvailable,    setOcAvailable]    = useState(false)
  const [input,          setInput]          = useState(() => {
    const captured = sessionStorage.getItem('capture_notes')
    if (captured) { sessionStorage.removeItem('capture_notes'); return captured }
    return ''
  })
  const [loading,  setLoading]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Check if OpenClaw gateway is available
  useEffect(() => {
    if (typeof window !== 'undefined' && window.seniorPartner?.openClawStatus) {
      window.seniorPartner.openClawStatus().then(({ running }) => {
        setOcAvailable(running)
        if (running) setUseOpenClaw(true) // auto-enable if available
      })
    }
  }, [])

  async function send(prompt: string) {
    if (!prompt.trim() || loading || !apiKey) return
    const userMsg: Message = { role: 'user', content: prompt }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      let text = ''

      if (useOpenClaw && ocAvailable && window.seniorPartner?.openClawChat) {
        // Route through OpenClaw gateway — persistent memory injected automatically
        const result = await window.seniorPartner.openClawChat({
          messages: newMessages,
          system:   buildSystem(mode),
        })
        if (result.success && result.response) {
          text = result.response
        } else {
          // Gateway unreachable or misconfigured — silently fall back to direct Claude
          console.warn('[OpenClaw] gateway error, falling back to Claude API:', result.error)
          setOcAvailable(false)
          setUseOpenClaw(false)
        }
      }

      // Direct Claude API (always runs if OpenClaw didn't produce text)
      if (!text) {
        const res = await fetch(CLAUDE_URL, {
          method: 'POST',
          headers: claudeHeaders(apiKey),
          body: JSON.stringify({
            model:      'claude-sonnet-4-6',
            max_tokens: 2048,
            system:     buildSystem(mode),
            messages:   newMessages,
          }),
        })
        const data = await res.json()
        if (!res.ok || data.error) throw new Error(data.error?.message ?? `API error ${res.status}`)
        text = data.content?.[0]?.text
        if (!text) throw new Error('Empty response — verify your Anthropic API key in Settings.')
      }

      setMessages([...newMessages, { role: 'assistant', content: text }])

      // Push Q&A to OpenClaw daily memory (fire-and-forget — never blocks UI)
      window.seniorPartner?.openClawMemoryWrite?.({
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
    } finally {
      setLoading(false)
    }
  }

  function formatAssistantContent(text: string) {
    // Highlight IRAC section labels
    return text
      .replace(/^(ISSUE:.*)/gm,      '<div class="irac-label irac-issue">$1</div>')
      .replace(/^(RULE:.*)/gm,       '<div class="irac-label irac-rule">$1</div>')
      .replace(/^(ANALYSIS:.*)/gm,   '<div class="irac-label irac-analysis">$1</div>')
      .replace(/^(CONCLUSION:.*)/gm, '<div class="irac-label irac-conclusion">$1</div>')
      .replace(/^(MISSED:.*)/gm,     '<div class="irac-label irac-missed">$1</div>')
      .replace(/^(HOOK:.*)/gm,       '<div class="irac-label irac-hook">★ $1</div>')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar — session config */}
      <aside className="w-72 shrink-0 bg-surface-container-low border-r border-outline-variant/10 flex flex-col p-6 gap-6 overflow-y-auto no-scrollbar">
        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-3">Subject</p>
          <div className="space-y-1">
            {SUBJECTS.map((s) => (
              <button
                key={s.value}
                onClick={() => { setSubject(s.value); setMessages([]) }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-label uppercase tracking-wider transition-colors ${
                  subject === s.value ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-3">Mode</p>
          <div className="space-y-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => { setMode(m.value); setMessages([]) }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-label uppercase tracking-wider transition-colors ${
                  mode === m.value ? 'bg-surface-container-lowest text-primary shadow-sm font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="material-symbols-outlined text-base">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-3">Quick Drills</p>
          <div className="space-y-1">
            {(QUICK_DRILLS[subject] ?? []).map((drill) => (
              <button
                key={drill}
                onClick={() => send(`Let's drill: ${drill}`)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors"
              >
                → {drill}
              </button>
            ))}
          </div>
        </div>

        {/* OpenClaw memory toggle */}
        {ocAvailable && (
          <button
            onClick={() => setUseOpenClaw((p) => !p)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-label transition-all ${
              useOpenClaw
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-on-surface-variant hover:bg-surface-container-high border border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-base">hub</span>
            <span className="flex-1 text-left uppercase tracking-wider">
              {useOpenClaw ? 'OpenClaw Memory ON' : 'OpenClaw Memory OFF'}
            </span>
            <span className={`w-2 h-2 rounded-full ${useOpenClaw ? 'bg-primary' : 'bg-outline-variant'}`} />
          </button>
        )}

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
              {useOpenClaw && ocAvailable && (
                <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-xs font-medium text-primary">
                  <span className="material-symbols-outlined text-sm">hub</span>
                  OpenClaw persistent memory active — your study history will inform every response
                </div>
              )}
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
                  <div
                    className="irac-response"
                    dangerouslySetInnerHTML={{ __html: formatAssistantContent(msg.content) }}
                  />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface-container-low border border-outline-variant/10 rounded-xl rounded-bl-sm px-5 py-4 flex gap-1.5">
                {[0, 150, 300].map((d) => (
                  <div key={d} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-outline-variant/10 p-4 bg-surface-container-lowest">
          {!apiKey && (
            <p className="text-xs text-error mb-2 text-center">Add your Anthropic API key in Settings to start a session.</p>
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

      <style>{`
        .irac-label { font-weight: 700; padding: 4px 0; }
        .irac-issue      { color: #546345; border-left: 3px solid #a4b491; padding-left: 8px; margin: 8px 0; }
        .irac-rule       { color: #556349; border-left: 3px solid #bcccac; padding-left: 8px; margin: 8px 0; }
        .irac-analysis   { color: #45483f; border-left: 3px solid #c5c8bc; padding-left: 8px; margin: 8px 0; }
        .irac-conclusion { color: #546345; border-left: 3px solid #a4b491; padding-left: 8px; margin: 8px 0; }
        .irac-missed     { color: #ba1a1a; border-left: 3px solid #ffdad6; padding-left: 8px; margin: 8px 0; }
        .irac-hook       { color: #38462b; background: #d8e8c2; padding: 4px 8px; border-radius: 4px; margin: 8px 0; }
      `}</style>
    </div>
  )
}
