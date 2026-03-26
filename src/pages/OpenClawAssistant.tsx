import { useEffect, useRef, useState } from 'react'
import { loadCourses, saveCourses, type LocalCourse } from '../lib/courses'

// Teach TypeScript about Electron's <webview> tag
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        allowpopups?: string
        nodeintegration?: string
      }
    }
  }
}

const FALLBACK_DASHBOARD_URL = 'http://127.0.0.1:18789/#token=slp-bianna-gateway-2026'

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
  scanPath:  string
}

const api = () => (window as any).seniorPartner

export function OpenClawAssistant() {
  const [status, setStatus]     = useState<'checking' | 'online' | 'offline'>('checking')
  const [starting, setStarting]   = useState(false)
  const [timedOut, setTimedOut]   = useState(false)
  const webviewRef                = useRef<HTMLElement | null>(null)

  // Offline AI fallback
  const [offlinePrompt, setOfflinePrompt]   = useState<string | null>(null)
  const [offlineReply, setOfflineReply]     = useState<string | null>(null)
  const [offlineLoading, setOfflineLoading] = useState(false)

  // Live dashboard URL (fetched from `openclaw dashboard --no-open` once gateway is online)
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null)
  const [webviewUrl,   setWebviewUrl]   = useState<string>('')

  // File scan / import
  const [scanning, setScanning]     = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError]   = useState<string | null>(null)
  const [importDone, setImportDone] = useState(false)

  useEffect(() => { checkStatus() }, [])

  // Fetch the live dashboard URL (contains real gateway token) once gateway is online
  useEffect(() => {
    if (status !== 'online') return
    api()?.openClawGetDashboardUrl?.()
      .then((url: string | null) => { setDashboardUrl(url ?? FALLBACK_DASHBOARD_URL) })
      .catch(() => { setDashboardUrl(FALLBACK_DASHBOARD_URL) })
  }, [status])

  // Auto-inject the gateway token into the connect form once the webview dom-ready fires.
  // Uses the live token parsed from the dashboard URL so it always matches the running gateway.
  useEffect(() => {
    if (status !== 'online' || !dashboardUrl) return
    const wv = webviewRef.current as any
    if (!wv) return

    // Parse token from hash fragment: http://.../#token=TOKEN
    const liveToken = dashboardUrl.split('#token=')[1]?.split(/[&?#]/)[0] ?? ''

    const autoConnect = () => {
      wv.executeJavaScript(`
        (() => {
          function fill(el, val) {
            const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            if (s) { s.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }
            else    { el.value = val;  el.dispatchEvent(new Event('input', { bubbles: true })) }
          }
          function tryConnect(n) {
            const inputs = Array.from(document.querySelectorAll('input'))
            const tokenInput = inputs.find(i =>
              (i.placeholder || '').toLowerCase().includes('token') ||
              (i.name        || '').toLowerCase().includes('token')
            )
            if (tokenInput) {
              fill(tokenInput, ${JSON.stringify(liveToken)})
              setTimeout(() => {
                const btn = document.querySelector('button[type="submit"]') ||
                  [...document.querySelectorAll('button')].find(b => /connect/i.test(b.textContent || ''))
                if (btn) (btn as HTMLButtonElement).click()
              }, 250)
            } else if (n < 20) {
              setTimeout(() => tryConnect(n + 1), 300)
            }
          }
          tryConnect(0)
        })()
      `).catch(() => {})
    }

    wv.addEventListener('dom-ready', autoConnect)
    return () => wv.removeEventListener('dom-ready', autoConnect)
  }, [status, dashboardUrl])

  async function checkStatus() {
    setStatus('checking')
    try {
      const res = await api()?.openClawStatus?.()
      setStatus(res?.running ? 'online' : 'offline')
    } catch {
      setStatus('offline')
    }
  }

  async function handleStart() {
    setStarting(true)
    setTimedOut(false)
    try { await api()?.openClawStartGateway?.() } catch { /* ignore */ }
    // Poll every 2 s for up to 30 s (matches the main-process timeout)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const res = await api()?.openClawStatus?.()
        if (res?.running) { setStatus('online'); setStarting(false); return }
      } catch { /* continue polling */ }
    }
    setStarting(false)
    setTimedOut(true)
    await checkStatus()
  }

  async function sendQuickAction(prompt: string) {
    if (status === 'online') {
      // Inject prompt into the OpenClaw webview input
      const wv = webviewRef.current as any
      if (!wv) return
      wv.executeJavaScript(`
        (() => {
          const el = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
          if (!el) return;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(el, ${JSON.stringify(prompt)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            el.textContent = ${JSON.stringify(prompt)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          el.focus();
        })()
      `).catch(() => {})
    } else {
      // Offline fallback: call Claude directly via IPC
      setScanResult(null)
      setScanError(null)
      setOfflinePrompt(prompt)
      setOfflineReply(null)
      setOfflineLoading(true)
      try {
        const res = await api()?.aiPromptSend?.({ prompt, mode: 'chat' })
        setOfflineReply(res?.response ?? res?.error ?? 'No response received.')
      } catch {
        setOfflineReply('Could not reach AI. Check your API key in Settings.')
      } finally {
        setOfflineLoading(false)
      }
    }
  }

  async function handleOpenTerminal() {
    setStarting(true)
    setTimedOut(false)
    try { await api()?.openClawOpenTerminal?.() } catch { /* ignore */ }
    // Poll every 2 s for up to 40 s (user types y/n in the terminal)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const res = await api()?.openClawStatus?.()
        if (res?.running) { setStatus('online'); setStarting(false); return }
      } catch { /* continue */ }
    }
    setStarting(false)
    setTimedOut(true)
  }

  async function handleScan() {
    setScanning(true)
    setScanResult(null)
    setScanError(null)
    setImportDone(false)
    setOfflinePrompt(null)
    setOfflineReply(null)
    try {
      const res = await api()?.scanLegalFiles?.()
      if (!res)            { setScanError('Feature not available — rebuild the app to enable this.'); return }
      if (res.canceled)    { return }
      if (!res.success)    { setScanError(res.error ?? 'Scan failed.'); return }
      if (res.total === 0) { setScanError('No legal documents found in that folder.'); return }

      setScanResult(res)

      // Auto-import detected courses into localStorage → Reading Tracker picks these up
      if (res.courses?.length > 0) {
        const existing     = loadCourses()
        const existingNames = new Set(existing.map((c: LocalCourse) => c.name.toLowerCase()))
        const newCourses: LocalCourse[] = (res.courses as ScanResult['courses'])
          .filter(c => c.courseName && !existingNames.has(c.courseName.toLowerCase()))
          .map(c => ({
            id:         crypto.randomUUID(),
            name:       c.courseName,
            professor:  c.professor ?? null,
            exam_date:  null,
            semester:   c.semester || 'Spring 2026',
            created_at: new Date().toISOString(),
          }))
        if (newCourses.length > 0) saveCourses([...existing, ...newCourses])
      }

      setImportDone(true)
    } catch (err: any) {
      setScanError(err?.message ?? 'Unexpected error during scan.')
    } finally {
      setScanning(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-0 min-h-0">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-serif text-on-surface">AI Assistant</h1>
          <p className="text-xs text-on-surface-variant mt-0.5 font-label tracking-wide">
            Persistent memory · Legal research · Document tools
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${
            status === 'online'  ? 'bg-green-500'              :
            status === 'offline' ? 'bg-red-400'                :
                                   'bg-amber-400 animate-pulse'
          }`} />
          <span className="text-xs text-on-surface-variant font-label uppercase tracking-wide">
            {status === 'online' ? 'Gateway Online' : status === 'offline' ? 'Gateway Offline' : 'Checking…'}
          </span>
        </div>
      </div>

      {/* Body: sidebar + main panel */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── Sidebar ────────────────────────────────────────────────────────── */}
        <aside className="w-52 shrink-0 flex flex-col gap-1.5 overflow-y-auto no-scrollbar">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60 mb-1 px-1">
            Quick Actions
          </p>

          {QUICK_ACTIONS.map(({ icon, label, prompt }) => (
            <button
              key={label}
              onClick={() => sendQuickAction(prompt)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-label text-left w-full cursor-pointer
                bg-surface-container hover:bg-primary/10 hover:text-primary active:scale-[0.98]
                transition-all duration-150 group"
            >
              <span className="material-symbols-outlined text-[18px] shrink-0 text-primary group-hover:text-primary">
                {icon}
              </span>
              <span className="leading-tight flex-1">{label}</span>
              {status !== 'online' && (
                <span
                  className="material-symbols-outlined text-[11px] text-amber-500 shrink-0"
                  title="Uses Claude directly (no gateway)"
                >bolt</span>
              )}
            </button>
          ))}

          {/* Scan & Import */}
          <div className="mt-3 pt-3 border-t border-outline-variant/10 space-y-1.5">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60 px-1">
              Import
            </p>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-label text-left w-full
                bg-primary/10 hover:bg-primary/20 active:scale-[0.98]
                transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px] text-primary shrink-0">
                {scanning ? 'hourglass_empty' : 'folder_open'}
              </span>
              <span className="leading-tight text-primary font-semibold">
                {scanning ? 'Scanning…' : 'Scan & Import Files'}
              </span>
            </button>
            <p className="text-[10px] text-on-surface-variant/50 px-1 leading-relaxed">
              Point to your law school folder — courses and documents are sorted automatically.
            </p>
          </div>

          {/* Refresh */}
          <div className="mt-auto pt-3 border-t border-outline-variant/10">
            <button
              onClick={checkStatus}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs w-full
                text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Refresh Status
            </button>
          </div>
        </aside>

        {/* ── Main panel ─────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-outline-variant/20 min-h-0">

          {/* Checking spinner */}
          {status === 'checking' && (
            <div className="flex-1 flex items-center justify-center text-on-surface-variant/40">
              <span className="material-symbols-outlined text-4xl" style={{ animation: 'spin 1.2s linear infinite' }}>
                progress_activity
              </span>
            </div>
          )}

          {/* ── Scan error ── */}
          {status !== 'checking' && scanError && !scanResult && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <span className="material-symbols-outlined text-5xl text-red-400/50">error</span>
              <div>
                <p className="text-sm font-semibold text-on-surface">Scan Failed</p>
                <p className="text-xs text-on-surface-variant mt-1">{scanError}</p>
              </div>
              <button onClick={() => setScanError(null)} className="text-xs text-primary underline">
                Dismiss
              </button>
            </div>
          )}

          {/* ── Scan results ── */}
          {status !== 'checking' && scanResult && (
            <div className="flex-1 flex flex-col p-6 gap-4 overflow-y-auto">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-serif text-on-surface">Import Complete</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Scanned {scanResult.total} files · {scanResult.scanPath}
                  </p>
                </div>
                <button
                  onClick={() => { setScanResult(null); setImportDone(false) }}
                  className="text-on-surface-variant hover:text-on-surface p-1"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              {importDone && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 rounded-lg text-xs text-green-800 border border-green-200">
                  <span className="material-symbols-outlined text-base text-green-600">check_circle</span>
                  <span>
                    <strong>{scanResult.courses.length}</strong> course{scanResult.courses.length !== 1 ? 's' : ''} added to Reading Tracker ·{' '}
                    <strong>{scanResult.documents.length}</strong> document{scanResult.documents.length !== 1 ? 's' : ''} copied to Bianna_Law folder
                  </span>
                </div>
              )}

              {scanResult.courses.length > 0 && (
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60 mb-2">
                    Courses → Reading Tracker
                  </p>
                  <div className="space-y-1.5">
                    {scanResult.courses.map((c, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-surface-container rounded-lg">
                        <span className="material-symbols-outlined text-[16px] text-primary">menu_book</span>
                        <div>
                          <p className="text-xs font-semibold text-on-surface">{c.courseName}</p>
                          {c.professor && (
                            <p className="text-[10px] text-on-surface-variant">{c.professor} · {c.semester}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {scanResult.documents.length > 0 && (
                <div>
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60 mb-2">
                    Documents → Bianna_Law Folder
                  </p>
                  <div className="space-y-1.5">
                    {scanResult.documents.map((d, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-surface-container rounded-lg">
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">article</span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-on-surface truncate">{d.title}</p>
                          <p className="text-[10px] text-on-surface-variant capitalize">
                            {d.type.replace(/_/g, ' ')} · {d.subject.replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Offline: quick-action response panel ── */}
          {status !== 'checking' && !scanResult && !scanError && status === 'offline' && offlinePrompt && (
            <div className="flex-1 flex flex-col p-6 gap-4 overflow-y-auto">
              <div className="bg-surface-container rounded-lg p-3">
                <p className="text-[10px] text-on-surface-variant uppercase tracking-wide font-label mb-1">Your question</p>
                <p className="text-sm text-on-surface">{offlinePrompt}</p>
              </div>

              {offlineLoading ? (
                <div className="flex items-center gap-2 text-on-surface-variant text-xs animate-pulse">
                  <span className="material-symbols-outlined text-base">hourglass_empty</span>
                  Asking Claude directly…
                </div>
              ) : offlineReply ? (
                <div className="bg-primary/5 rounded-lg p-4 border border-primary/10">
                  <p className="text-[10px] text-primary uppercase tracking-wide font-label mb-2">Claude's Response</p>
                  <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{offlineReply}</p>
                </div>
              ) : null}

              <button
                onClick={() => { setOfflinePrompt(null); setOfflineReply(null) }}
                className="self-start text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1 mt-2"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Back
              </button>
            </div>
          )}

          {/* ── Offline: default state ── */}
          {status !== 'checking' && !scanResult && !scanError && status === 'offline' && !offlinePrompt && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
              <span className="material-symbols-outlined text-7xl text-on-surface-variant/20">smart_toy</span>
              <div>
                <h3 className="text-xl font-serif text-on-surface mb-2">OpenClaw Gateway Offline</h3>
                {timedOut ? (
                  <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
                    Gateway didn't respond after 30 s. Start OpenClaw manually in a terminal
                    (<code className="text-xs bg-surface-container px-1.5 py-0.5 rounded font-mono">openclaw gateway</code>),
                    then click <strong>Refresh Status</strong>. Or use Quick Actions to ask Claude directly.
                  </p>
                ) : (
                  <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
                    Start the gateway for full persistent memory, or use the Quick Actions on the left to ask Claude directly — no gateway needed.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <button
                  onClick={handleOpenTerminal}
                  disabled={starting}
                  className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-full
                    text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity active:scale-95"
                >
                  <span className="material-symbols-outlined text-base">
                    {starting ? 'hourglass_empty' : 'terminal'}
                  </span>
                  {starting ? 'Waiting… (type y in terminal)' : 'Start Agent'}
                </button>
                <button
                  onClick={handleStart}
                  disabled={starting}
                  className="flex items-center gap-2 px-5 py-3 border border-primary/30 text-primary rounded-full
                    text-sm font-semibold hover:bg-primary/5 disabled:opacity-60 transition-colors active:scale-95"
                >
                  <span className="material-symbols-outlined text-base">
                    {starting ? 'hourglass_empty' : 'rocket_launch'}
                  </span>
                  {timedOut ? 'Retry (Background)' : 'Start (Background)'}
                </button>
                <button
                  onClick={() => sendQuickAction('Summarize everything you know about my coursework and study sessions so far.')}
                  className="flex items-center gap-2 px-5 py-3 border border-primary/30 text-primary rounded-full
                    text-sm font-semibold hover:bg-primary/5 transition-colors active:scale-95"
                >
                  <span className="material-symbols-outlined text-base">bolt</span>
                  Ask Claude Directly
                </button>
              </div>
              {starting && (
                <p className="text-xs text-on-surface-variant animate-pulse">
                  Launching gateway — polling every 2 s for up to 30 s…
                </p>
              )}
            </div>
          )}

          {/* ── Online: OpenClaw webview (loaded only after we have the live dashboard URL) ── */}
          {status === 'online' && !scanResult && !scanError && dashboardUrl && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Browser navigation bar */}
              <div className="flex items-center gap-1 px-2 py-1.5 bg-surface-container-low border-b border-outline-variant/10 shrink-0">
                <button
                  onClick={() => (webviewRef.current as any)?.goBack?.()}
                  title="Back"
                  className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-base">arrow_back</span>
                </button>
                <button
                  onClick={() => (webviewRef.current as any)?.goForward?.()}
                  title="Forward"
                  className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
                <button
                  onClick={() => (webviewRef.current as any)?.reload?.()}
                  title="Refresh"
                  className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                </button>
                <div className="flex-1 mx-2 px-3 py-1 bg-surface-container rounded text-xs text-on-surface-variant font-mono truncate select-all">
                  {webviewUrl || dashboardUrl}
                </div>
                <button
                  onClick={() => (webviewRef.current as any)?.loadURL?.(dashboardUrl)}
                  title="Home — OpenClaw Dashboard"
                  className="p-1.5 rounded hover:bg-surface-container-high text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-base">home</span>
                </button>
              </div>
              <webview
                ref={(el) => {
                  (webviewRef as any).current = el
                  if (el) {
                    const wv = el as any
                    const onNav = () => setWebviewUrl(wv.getURL?.() ?? '')
                    wv.addEventListener('did-navigate',         onNav)
                    wv.addEventListener('did-navigate-in-page', onNav)
                  }
                }}
                src={dashboardUrl}
                className="flex-1 w-full border-0"
                style={{ height: '100%' }}
                allowpopups={true as any}
              />
            </div>
          )}
          {/* Small spinner while fetching the dashboard URL */}
          {status === 'online' && !scanResult && !scanError && !dashboardUrl && (
            <div className="flex-1 flex items-center justify-center text-on-surface-variant/40">
              <span className="material-symbols-outlined text-4xl" style={{ animation: 'spin 1.2s linear infinite' }}>
                progress_activity
              </span>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
