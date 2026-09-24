import { useEffect, useRef, useState } from 'react'
import { loadCourses, saveCourses, type LocalCourse } from '../lib/courses'
import { useAppStore } from '../store/appStore'
import { streamAi, abortStream, newStreamId } from '../lib/aiStream'
import { ChatBubble } from '../components/ChatBubble'

/**
 * AI Assistant — the app's chat surface.
 *
 * Rebuilt as a real conversation: editable input (Enter sends, Shift+Enter adds a
 * newline), Send/Stop, streaming answers with the model's reasoning trace, and
 * per-message Copy / Retry / Delete. The earlier model-bridge scaffolding
 * (status pill, dashboard webview, token auto-injection) is gone;
 * Supermemory, RAG and the ICM corpus still ground every reply.
 */

const QUICK_ACTIONS = [
  { icon: 'gavel',       label: 'Case Research',   prompt: 'Research the legal precedents and key holdings for: '         },
  { icon: 'balance',     label: 'Rule Analysis',   prompt: 'Analyze this legal rule and its exceptions: '                 },
  { icon: 'summarize',   label: 'Memory Recall',   prompt: 'Summarize everything you know about my coursework and study sessions so far.' },
  { icon: 'history_edu', label: 'Case Brief',      prompt: 'Create an IRAC case brief for: '                              },
  { icon: 'psychology',  label: 'Exam Prep',       prompt: 'Give me exam practice questions and model answers for: '      },
  { icon: 'event_note',  label: 'Study Schedule',  prompt: 'Help me build a study schedule for the week around: '         },
]

type ScanResult = {
  courses:   Array<{ courseName: string; professor: string | null; semester: string; fileName: string }>
  documents: Array<{ title: string; type: string; subject: string; fileName: string }>
  total:     number
  scanPath?: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  biaHtml?: string | null
}

const uid = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export function Assistant() {
  const apiKey = useAppStore((s) => s.apiKey)

  const [messages, setMessages] = useState<ChatMessage[]>([])

  // ── Part 4: one persistent thread per quick action ─────────────────────────
  // The id is derived from the label, so the rail's data shape is unchanged and the ids
  // cannot drift from the closed set the main process accepts.
  const [activeAction, setActiveAction] = useState<string>('study-schedule')
  const [threadMeta, setThreadMeta] = useState<Record<string, { daysLoaded: number; tokens: number; truncated: boolean }>>({})
  const actionId = (label: string) => label.toLowerCase().replace(/\s+/g, '-')
  const [input,    setInput]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [streamText, setStreamText] = useState('')
  const [reasoning,  setReasoning]  = useState('')
  const [error,      setError]      = useState<string | null>(null)
  const [copiedId,   setCopiedId]   = useState<string | null>(null)

  // Load the active thread on mount and on every switch. Threads live on disk, so an action
  // switched away from reloads from its own files - which is what makes yesterday's
  // conversation still be here this morning.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.seniorPartner?.loadChatThread?.({ action: activeAction })
        if (cancelled || !res?.success) return
        setMessages((res.messages || []).map((m) => ({
          id: uid(),
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })))
        setThreadMeta((prev) => ({
          ...prev,
          [activeAction]: { daysLoaded: res.daysLoaded ?? 0, tokens: res.tokens ?? 0, truncated: !!res.truncated },
        }))
      } catch { /* history is a convenience: the chat still works without it */ }
    })()
    return () => { cancelled = true }
  }, [activeAction])

  const streamIdRef = useRef<string | null>(null)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)

  // File scan / import (kept from the previous version — unrelated to AI chat)
  const [scanning,   setScanning]   = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError,  setScanError]  = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])


  /** Send a prompt (defaults to the current input) with the conversation history. */
  async function send(promptOverride?: string) {
    const text = (promptOverride ?? input).trim()
    if (!text || busy) return
    if (!apiKey) { setError('Add your DeepSeek API key in Settings first.'); return }

    setError(null)
    setInput('')
    setStreamText('')
    setReasoning('')

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setBusy(true)

    // Prior turns + the new prompt. The main process prepends its persona, the
    // reasoning contract, the ICM corpus and the RAG context.
    const conversation = history.map((m) => ({ role: m.role, content: m.content }))

    const streamId = newStreamId()
    streamIdRef.current = streamId

    try {
      const outcome = await streamAi({
        messages: conversation,
        mode: 'chat',
        apiKey,
        maxTokens: 8192,
        streamId,
        onContent:   (d) => setStreamText((prev) => prev + d),
        onReasoning: (d) => setReasoning((prev) => prev + d),
      })

      if (outcome.error && !outcome.aborted) throw new Error(outcome.error)

      const answer = outcome.content.trim()

      // Persist the question before answering, so a crash mid-stream cannot lose the
      // exchange entirely (Part 4). `text` is the resolved user turn; bare `prompt` here
      // would be window.prompt.
      void window.seniorPartner?.appendChatTurn?.({ action: activeAction, role: 'user', content: userMsg.content })

      // Part 3: render the answer in the house four-tier language. Off the critical path
      // and failure-tolerant: the plain answer is kept if the formatter is unavailable, so
      // a formatting outage never costs her the response. Skipped for an aborted answer.
      let biaHtml: string | null = null
      if (answer && !outcome.aborted) {
        try {
          const bia = await window.seniorPartner?.aiFormatBia?.({ text: answer })
          if (bia?.success && bia.biaHtml) biaHtml = bia.biaHtml
        } catch { /* keep the plain answer */ }
      }

      if (answer) {
        setMessages((prev) => [...prev, {
          id: uid(),
          role: 'assistant',
          content: outcome.aborted ? `${answer}\n\n_(stopped)_` : answer,
          reasoning: outcome.reasoning || undefined,
          biaHtml,
        }])
        void window.seniorPartner?.appendChatTurn?.({ action: activeAction, role: 'assistant', content: biaHtml ?? answer })
      } else if (!outcome.aborted) {
        throw new Error('DeepSeek returned an empty answer. Try again or switch models in Settings.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setStreamText('')
      setReasoning('')
      streamIdRef.current = null
      inputRef.current?.focus()
    }
  }

  /** Cancel the in-flight stream; whatever streamed so far is kept. */
  async function stop() {
    await abortStream(streamIdRef.current)
  }

  /** Re-ask the user message that produced the assistant reply at `index`. */
  async function retry(index: number) {
    const priorUser = [...messages.slice(0, index)].reverse().find((m) => m.role === 'user')
    if (!priorUser) return
    const cut = messages.findIndex((m) => m.id === priorUser.id)
    setMessages(messages.slice(0, cut))
    await send(priorUser.content)
  }

  function removeAt(index: number) {
    setMessages((prev) => prev.filter((_, i) => i !== index))
  }

  async function copy(msg: ChatMessage) {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopiedId(msg.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch { /* clipboard unavailable */ }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  async function handleScan() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    try {
      const sp = (window as any).seniorPartner
      const res = await sp?.scanLegalFiles?.()
      if (!res)            { setScanError('Feature not available — rebuild the app to enable this.'); return }
      if (res.canceled)    { return }
      if (!res.success)    { setScanError(res.error ?? 'Scan failed.'); return }
      if (res.total === 0) { setScanError('No legal documents found in that folder.'); return }

      setScanResult(res)

      // Auto-import detected courses into localStorage → Reading Tracker picks these up
      if (res.courses?.length > 0) {
        const existing = loadCourses()
        const existingNames = new Set(existing.map((c: LocalCourse) => c.name.toLowerCase()))
        const newCourses: LocalCourse[] = (res.courses as ScanResult['courses'])
          .filter((c) => c.courseName && !existingNames.has(c.courseName.toLowerCase()))
          .map((c) => ({
            id:         crypto.randomUUID(),
            name:       c.courseName,
            professor:  c.professor ?? null,
            exam_date:  null,
            semester:   c.semester || 'Spring 2026',
            created_at: new Date().toISOString(),
          }))
        if (newCourses.length > 0) saveCourses([...existing, ...newCourses])
      }
    } catch (err) {
      setScanError((err as Error).message ?? 'Unexpected error during scan.')
    } finally {
      setScanning(false)
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full min-h-0 gap-6">
      {/* Quick actions rail — prefills the composer so the prompt stays editable */}
      <aside className="w-56 shrink-0 flex flex-col gap-2" data-testid="quick-action-rail">
        <p className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold mb-1">Quick Actions</p>
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            data-testid={`quick-action-${actionId(a.label)}`}
            onClick={() => { setActiveAction(actionId(a.label)); setInput(a.prompt); inputRef.current?.focus() }}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-label transition-colors ${
              activeAction === actionId(a.label)
                ? 'bg-surface-container-lowest border border-primary text-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base">{a.icon}</span>
            {a.label}
          </button>
        ))}

        {threadMeta[activeAction] && (
          <p className="text-[10px] text-on-surface-variant px-1 leading-snug" data-testid="thread-history">
            History: {threadMeta[activeAction].daysLoaded} day(s), ~{threadMeta[activeAction].tokens} tokens
            {threadMeta[activeAction].truncated ? ' - older turns via Memory Recall' : ''}
          </p>
        )}

        <div className="mt-auto space-y-2 pt-4 border-t border-outline-variant/10">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-xs font-label text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">folder_managed</span>
            {scanning ? 'Scanning…' : 'Scan & sort my files'}
          </button>
          {scanError && <p className="text-[10px] text-error px-1">{scanError}</p>}
          {scanResult && (
            <p className="text-[10px] text-primary px-1">
              Imported {scanResult.courses.length} course{scanResult.courses.length === 1 ? '' : 's'} from {scanResult.total} files.
            </p>
          )}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex-1 min-w-0 flex flex-col">
        <header className="pb-4 border-b border-outline-variant/10">
          <h1 className="font-serif text-2xl text-on-surface">AI Assistant</h1>
          <p className="text-xs text-on-surface-variant mt-0.5 font-label tracking-wide">
            Persistent memory · RAG · Your ICM corpus
          </p>
        </header>

        <div className="flex-1 overflow-y-auto py-6 space-y-5 min-h-0">
          {messages.length === 0 && !busy && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-5xl text-outline-variant">forum</span>
              <p className="font-serif text-xl max-w-md">
                Ask anything about your coursework. DeepSeek R1 is reasoning from your ICM corpus.
              </p>
              <p className="text-xs max-w-sm">
                The quick actions on the left fill the composer so you can edit before sending.
              </p>
            </div>
          )}


          {messages.map((msg, i) => (
            <div key={msg.id} className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-2xl flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-xl px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap ${
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

                {msg.role === 'assistant' && msg.reasoning && (
                  <details className="w-full rounded-xl border border-outline-variant/20 bg-surface-container-low">
                    <summary className="cursor-pointer select-none px-4 py-2 text-[10px] font-label font-bold uppercase tracking-widest text-on-surface-variant">
                      DeepSeek&apos;s Legal Reasoning Trace
                    </summary>
                    <pre className="px-4 pb-3 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-on-surface-variant font-mono">
                      {msg.reasoning}
                    </pre>
                  </details>
                )}

                {/* Per-message actions */}
                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => copy(msg)}
                    className="text-[10px] font-label uppercase tracking-wider text-on-surface-variant hover:text-primary"
                  >
                    {copiedId === msg.id ? 'Copied ✓' : 'Copy'}
                  </button>
                  {msg.role === 'assistant' && (
                    <button
                      onClick={() => retry(i)}
                      disabled={busy}
                      className="text-[10px] font-label uppercase tracking-wider text-on-surface-variant hover:text-primary disabled:opacity-40"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => removeAt(i)}
                    className="text-[10px] font-label uppercase tracking-wider text-on-surface-variant hover:text-error"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Live stream: answer tokens plus the reasoning trace as it thinks */}
          {busy && (
            <div className="flex justify-start">
              <div className="max-w-2xl w-full space-y-2">
                {streamText ? (
                  <div className="bg-surface-container-low text-on-surface rounded-xl rounded-bl-sm border border-outline-variant/10 px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">
                    {streamText}
                  </div>
                ) : (
                  <div className="bg-surface-container-low border border-outline-variant/10 rounded-xl rounded-bl-sm px-5 py-4 flex gap-1.5 w-fit">
                    {[0, 150, 300].map((d) => (
                      <div key={d} className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                )}
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

          {error && (
            <div className="bg-error-container text-on-error-container rounded-xl px-5 py-3 text-sm max-w-2xl">{error}</div>
          )}

          <div ref={bottomRef} />
        </div>


        {/* Composer — Enter sends, Shift+Enter adds a newline */}
        <footer className="pt-4 border-t border-outline-variant/10">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Ask about a rule, a case, or your schedule… (Enter to send, Shift+Enter for a new line)"
              aria-label="Message"
              className="flex-1 resize-none bg-surface-container-low rounded-xl px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all max-h-40"
            />
            {busy ? (
              <button
                onClick={stop}
                className="h-[46px] px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest border border-error text-error hover:bg-error-container transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => send()}
                disabled={!input.trim()}
                className="h-[46px] px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
          <p className="text-[10px] text-on-surface-variant mt-2">
            Grounded in your mirrored corpus, saved notes and persistent memory.
          </p>
        </footer>
      </section>
    </div>
  )
}

