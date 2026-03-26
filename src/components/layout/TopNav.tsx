import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/appStore'

// ── To-Do types (mirror LocalAssignment from Calendar.tsx) ────────────────
type TodoItem = {
  id: string
  title: string
  type: string
  due_date: string
  completed?: boolean
}

const LS_KEY = 'slp_assignments'

function loadTodos(): TodoItem[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}
function saveTodos(items: TodoItem[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items))
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/outline':   'Outline Generator',
  '/tracker':   'Reading Tracker',
  '/sessions':  'Study Sessions',
  '/vault':     'Document Vault',
  '/capture':   'Capture',
  '/calendar':  'Calendar',
  '/settings':  'Settings',
  '/assistant': 'AI Assistant',
}

type Diag = {
  appVersion:       string
  platform:         string
  nodeVersion:      string
  apiKeyPresent:    boolean
  notionKeyPresent: boolean
  openClaw:         { installed: boolean; running: boolean; port: number }
  biannaDir:        string
  biannaFileCount:  number
  freeMemMb:        number
}

const api = () => (window as any).seniorPartner

export function TopNav() {
  const location      = useLocation()
  const navigate      = useNavigate()
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const title         = PAGE_TITLES[location.pathname] ?? 'Senior Law Partner'

  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen,  setSearchOpen]  = useState(false)

  // ── To-Do / Notification panel ────────────────────────────────────────────
  const [todoOpen,  setTodoOpen]  = useState(false)
  const [todos,     setTodos]     = useState<TodoItem[]>([])

  useEffect(() => {
    if (!todoOpen) return
    setTodos(loadTodos())
  }, [todoOpen])

  const pendingCount = (() => {
    try {
      return (JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as TodoItem[])
        .filter((t) => !t.completed).length
    } catch { return 0 }
  })()

  const toggleTodo = useCallback((id: string) => {
    setTodos((prev) => {
      const next = prev.map((t) => t.id === id ? { ...t, completed: !t.completed } : t)
      saveTodos(next)
      return next
    })
  }, [])

  // ── Troubleshoot modal state ──────────────────────────────────────────────
  const [troubleshootOpen,  setTroubleshootOpen]  = useState(false)
  const [diag,              setDiag]              = useState<Diag | null>(null)
  const [diagLoading,       setDiagLoading]       = useState(false)
  const [analysis,          setAnalysis]          = useState<string | null>(null)
  const [analyzing,         setAnalyzing]         = useState(false)
  const [fixing,            setFixing]            = useState(false)

  async function openTroubleshoot() {
    setTroubleshootOpen(true)
    setDiag(null)
    setAnalysis(null)
    setDiagLoading(true)

    const d: Diag = await api()?.getDiagnostics?.()
    setDiag(d)
    setDiagLoading(false)

    if (!d) return
    setAnalyzing(true)
    const res = await api()?.aiPromptSend?.({
      prompt: `Senior Law Partner app diagnostics:\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\n\nAnalyze what is wrong (if anything) and give Bianna clear, numbered steps to fix it. Be very brief. Use ✅ for ok and ❌ for problems.`,
      systemPrompt: 'You are a technical support agent for the Senior Law Partner Electron app. Diagnose issues from the JSON and give short, actionable fixes. Max 150 words.',
      mode: 'chat',
    })
    setAnalysis(res?.response ?? 'Could not reach Claude for analysis.')
    setAnalyzing(false)
  }

  async function handleStartGateway() {
    setFixing(true)
    await api()?.openClawStartGateway?.()
    // re-run diagnostics to show updated state
    const d: Diag = await api()?.getDiagnostics?.()
    setDiag(d)
    setFixing(false)
  }

  function closeTroubleshoot() {
    setTroubleshootOpen(false)
    setDiag(null)
    setAnalysis(null)
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function openSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    window.open(
      `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
      'BiaSearch',
      'width=520,height=620,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes'
    )
    setSearchQuery('')
    setSearchOpen(false)
  }

  // ── Diag row helper ───────────────────────────────────────────────────────
  function DiagRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
    return (
      <div className="flex items-center gap-3 py-2 border-b border-outline-variant/10 last:border-0">
        <span className={`material-symbols-outlined text-base ${ok ? 'text-green-500' : 'text-red-400'}`}>
          {ok ? 'check_circle' : 'cancel'}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-on-surface">{label}</span>
          {detail && <span className="text-[10px] text-on-surface-variant ml-2">{detail}</span>}
        </div>
      </div>
    )
  }

  return (
    <>
      <header className="w-full sticky top-0 z-30 bg-surface/80 backdrop-blur-md flex justify-between items-center px-4 md:px-8 py-3 border-b border-outline-variant/20 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-6">
          <button
            onClick={toggleSidebar}
            className="text-on-surface-variant hover:text-primary transition-colors lg:hidden"
            aria-label="Toggle sidebar"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>

          <span className="text-2xl font-serif italic text-primary">Bia</span>

          <nav className="hidden lg:flex items-center gap-6">
            <span className="text-sm font-label uppercase tracking-wider text-on-surface-variant">{title}</span>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Mini web search */}
          {searchOpen ? (
            <form onSubmit={openSearch} className="flex items-center gap-1">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
                placeholder="Search the web…"
                className="w-52 bg-surface-container-low border border-outline-variant/30 focus:border-primary rounded-full px-4 py-1.5 text-sm outline-none transition-all"
              />
              <button type="submit" className="p-1.5 text-primary hover:bg-surface-container-high rounded-full transition-colors">
                <span className="material-symbols-outlined text-base">open_in_new</span>
              </button>
              <button type="button" onClick={() => setSearchOpen(false)} className="p-1.5 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </form>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
              aria-label="Web search"
              title="Open web search"
            >
              <span className="material-symbols-outlined">travel_explore</span>
            </button>
          )}

          {/* Troubleshoot button */}
          <button
            onClick={openTroubleshoot}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high hover:text-amber-600 rounded-full transition-colors"
            aria-label="Troubleshoot"
            title="Troubleshoot app issues"
          >
            <span className="material-symbols-outlined">build</span>
          </button>

          <button
            onClick={() => setTodoOpen((o) => !o)}
            className="relative p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
            aria-label="To-Do List"
            title="To-Do checklist"
          >
            <span className="material-symbols-outlined">notifications</span>
            {pendingCount > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 border border-surface">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <button
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
            aria-label="Profile"
          >
            <span className="material-symbols-outlined">account_circle</span>
          </button>
        </div>
      </header>

      {/* ── Troubleshoot Modal ─────────────────────────────────────────────── */}
      {/* ── To-Do Panel ────────────────────────────────────────────────────── */}
      {todoOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setTodoOpen(false)} />
          {/* Panel */}
          <div className="fixed top-14 right-4 z-50 w-80 max-h-[70vh] flex flex-col bg-surface rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">checklist</span>
                <h3 className="text-sm font-serif text-on-surface">To-Do Checklist</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-on-surface-variant font-label">
                  {todos.filter((t) => !t.completed).length} remaining
                </span>
                <button onClick={() => setTodoOpen(false)} className="p-0.5 text-on-surface-variant hover:text-on-surface">
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-outline-variant/10">
              {todos.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-on-surface-variant/50">
                  <span className="material-symbols-outlined text-3xl">event_available</span>
                  <p className="text-xs">No events yet — add one in Calendar.</p>
                </div>
              )}

              {/* Group: Pending */}
              {todos.filter((t) => !t.completed).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((t) => (
                <label key={t.id} className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-surface-container-low transition-colors">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleTodo(t.id)}
                    className="mt-0.5 accent-primary shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-on-surface leading-snug">{t.title}</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5 uppercase tracking-wide">
                      {t.type} · {new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </label>
              ))}

              {/* Group: Done */}
              {todos.filter((t) => t.completed).length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50 px-5 py-2 bg-surface-container/40">
                    Completed
                  </p>
                  {todos.filter((t) => t.completed).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((t) => (
                    <label key={t.id} className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-surface-container-low transition-colors opacity-50">
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => toggleTodo(t.id)}
                        className="mt-0.5 accent-primary shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-on-surface leading-snug line-through">{t.title}</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5 uppercase tracking-wide">
                          {t.type} · {new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-outline-variant/10">
              <button
                onClick={() => { setTodoOpen(false); navigate('/calendar') }}
                className="w-full text-xs text-primary font-label font-semibold hover:underline text-center"
              >
                Manage in Calendar →
              </button>
            </div>
          </div>
        </>
      )}

      {troubleshootOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeTroubleshoot() }}
        >
          <div className="bg-surface rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden border border-outline-variant/20">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-xl">build</span>
                <h2 className="text-base font-serif text-on-surface">System Diagnostics</h2>
              </div>
              <button
                onClick={closeTroubleshoot}
                className="p-1 text-on-surface-variant hover:text-on-surface rounded-full transition-colors"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

              {/* Loading spinner */}
              {diagLoading && (
                <div className="flex items-center gap-3 text-on-surface-variant text-sm animate-pulse py-4">
                  <span className="material-symbols-outlined text-xl">hourglass_empty</span>
                  Running diagnostics…
                </div>
              )}

              {/* Diagnostic rows */}
              {diag && (
                <div className="rounded-xl bg-surface-container p-4">
                  <DiagRow ok={diag.apiKeyPresent}        label="Anthropic API Key"      detail={diag.apiKeyPresent ? 'Configured' : 'Missing — go to Settings'} />
                  <DiagRow ok={diag.notionKeyPresent}     label="Notion Key"             detail={diag.notionKeyPresent ? 'Configured' : 'Optional'} />
                  <DiagRow ok={diag.openClaw.installed}   label="OpenClaw CLI"           detail={diag.openClaw.installed ? 'Installed' : 'Not installed'} />
                  <DiagRow ok={diag.openClaw.running}     label="OpenClaw Gateway"       detail={diag.openClaw.running ? `Running on :${diag.openClaw.port}` : 'Offline'} />
                  <DiagRow ok={diag.biannaFileCount >= 0} label="Bianna_Law Folder"      detail={`${diag.biannaFileCount} file${diag.biannaFileCount !== 1 ? 's' : ''}`} />
                  <DiagRow ok={diag.freeMemMb > 200}      label="Free Memory"            detail={`${diag.freeMemMb} MB`} />
                  <div className="pt-2 mt-1">
                    <p className="text-[10px] text-on-surface-variant/60 font-label">
                      v{diag.appVersion} · {diag.platform} · Node {diag.nodeVersion}
                    </p>
                  </div>
                </div>
              )}

              {/* Claude analysis */}
              {(analyzing || analysis) && (
                <div className="rounded-xl bg-primary/5 border border-primary/10 p-4">
                  <p className="text-[10px] font-label uppercase tracking-widest text-primary/70 mb-2">
                    Claude's Analysis
                  </p>
                  {analyzing ? (
                    <p className="text-xs text-on-surface-variant animate-pulse">Analyzing…</p>
                  ) : (
                    <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{analysis}</p>
                  )}
                </div>
              )}

            </div>

            {/* Modal footer — action buttons */}
            {diag && (
              <div className="px-6 py-4 border-t border-outline-variant/10 flex items-center gap-2 flex-wrap">
                {!diag.openClaw.running && (
                  <button
                    onClick={handleStartGateway}
                    disabled={fixing}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded-full text-xs font-semibold
                      hover:opacity-90 disabled:opacity-60 transition-opacity active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {fixing ? 'hourglass_empty' : 'rocket_launch'}
                    </span>
                    {fixing ? 'Starting…' : 'Start Gateway'}
                  </button>
                )}
                {!diag.apiKeyPresent && (
                  <button
                    onClick={() => { closeTroubleshoot(); navigate('/settings') }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-primary/30 text-primary rounded-full text-xs font-semibold
                      hover:bg-primary/5 transition-colors active:scale-95"
                  >
                    <span className="material-symbols-outlined text-sm">key</span>
                    Add API Key
                  </button>
                )}
                <button
                  onClick={() => { closeTroubleshoot(); navigate('/assistant') }}
                  className="flex items-center gap-1.5 px-4 py-2 border border-outline-variant/30 text-on-surface-variant rounded-full text-xs
                    hover:bg-surface-container-high transition-colors active:scale-95 ml-auto"
                >
                  <span className="material-symbols-outlined text-sm">smart_toy</span>
                  Open AI Assistant
                </button>
                <button
                  onClick={closeTroubleshoot}
                  className="px-4 py-2 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
