import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'
import { loadCourses, saveCourses, loadProfileIcon, saveProfileIcon, clearProfileIcon, type LocalCourse } from '../lib/courses'

declare global {
  interface Window {
    seniorPartner?: {
      openClawStatus:       () => Promise<{ installed: boolean; running: boolean }>
      openClawInstall:      () => Promise<{ success: boolean; output?: string; error?: string }>
      openClawStartGateway: () => Promise<{ success: boolean }>
      openClawChat:         (args: unknown) => Promise<{ success: boolean; response?: string; error?: string }>
      onOpenClawProgress:   (cb: (chunk: string) => void) => void
      [key: string]: unknown
    }
  }
}

const SEMESTERS = [
  'Spring 2026', 'Fall 2026',
  'Spring 2027', 'Fall 2027',
  'Spring 2028', 'Fall 2028',
  'Spring 2029', 'Fall 2029',
  'Spring 2030', 'Fall 2030',
]

type Tab = 'api' | 'courses' | 'profile' | 'preferences' | 'integrations'

/* ─── Add Course Modal ──────────────────────────────────────────────────── */
function AddCourseModal({ onAdd, onClose }: { onAdd: (c: LocalCourse) => void; onClose: () => void }) {
  const apiKey   = useAppStore((s) => s.apiKey)
  const fileRef  = useRef<HTMLInputElement>(null)

  const [name,        setName]        = useState('')
  const [professor,   setProfessor]   = useState('')
  const [examDate,    setExamDate]    = useState('')
  const [semester,    setSemester]    = useState('Spring 2026')
  const [scanning,    setScanning]    = useState(false)
  const [scanError,   setScanError]   = useState<string | null>(null)
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null)

  async function handleCapture(file: File) {
    if (!apiKey) { setScanError('Add your API key in the API tab first.'); return }
    setScanning(true)
    setScanError(null)
    setPreviewUrl(URL.createObjectURL(file))
    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((res, rej) => {
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const resp = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: claudeHeaders(apiKey),
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system: 'You extract law school course information from screenshots of syllabi, schedules, or course pages. Respond ONLY with valid JSON, no markdown: {"name":"full course name","professor":"Prof. Last Name or empty string","exam_date":"YYYY-MM-DD or empty string","semester":"Season YYYY e.g. Spring 2026"}',
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
            { type: 'text',  text: 'Extract the course details from this screenshot.' },
          ]}],
        }),
      })
      const json = await resp.json()
      const raw  = json.content?.[0]?.text ?? ''
      const s    = raw.indexOf('{'), e = raw.lastIndexOf('}')
      if (s < 0 || e < s) throw new Error('Could not parse course info from image.')
      const parsed = JSON.parse(raw.slice(s, e + 1))
      if (parsed.name)       setName(parsed.name)
      if (parsed.professor)  setProfessor(parsed.professor)
      if (parsed.exam_date)  setExamDate(parsed.exam_date)
      if (parsed.semester && SEMESTERS.includes(parsed.semester)) setSemester(parsed.semester)
    } catch (err) {
      setScanError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const course: LocalCourse = {
      id:         crypto.randomUUID(),
      name,
      professor:  professor  || null,
      exam_date:  examDate   || null,
      semester,
      created_at: new Date().toISOString(),
    }
    onAdd(course)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-[var(--shadow-modal)] overflow-hidden border border-outline-variant/20">
        <div className="p-8">
          <div className="flex justify-between items-start mb-2">
            <h2 className="font-serif text-3xl font-medium text-on-surface">Add New Course</h2>
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <p className="text-on-surface-variant text-sm mb-5 leading-relaxed">
            Enter course details manually, or screenshot your syllabus to auto-fill.
          </p>

          {/* Screenshot capture strip */}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleCapture(e.target.files[0]) }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="w-full flex items-center justify-center gap-2 py-3 mb-5 rounded-xl border-2 border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors text-sm font-bold disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-lg">{scanning ? 'hourglass_empty' : 'photo_camera'}</span>
            {scanning ? 'Scanning image…' : 'Screenshot / Photograph Syllabus to Auto-Fill'}
          </button>
          {previewUrl && !scanning && (
            <img src={previewUrl} alt="Scanned" className="w-full h-24 object-cover rounded-lg mb-4 border border-outline-variant/20" />
          )}
          {scanError && (
            <p className="text-xs text-error bg-error-container rounded-lg px-3 py-2 mb-4">{scanError}</p>
          )}

          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Course Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Constitutional Law"
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Professor Name</label>
              <input value={professor} onChange={(e) => setProfessor(e.target.value)}
                placeholder="e.g., Prof. Elena Kagan"
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Exam Date</label>
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Semester</label>
                <select value={semester} onChange={(e) => setSemester(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                >
                  {SEMESTERS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 bg-white text-primary border border-primary-container rounded-full py-3 font-bold text-sm hover:bg-stone-50 transition-all">
                Cancel
              </button>
              <button type="submit"
                className="flex-1 bg-tertiary-container text-on-tertiary-container rounded-full py-3 font-bold text-sm shadow-sm hover:shadow-md transition-all">
                Add Course
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ─── Settings Page ──────────────────────────────────────────────────────── */
export function Settings() {
  const { apiKey, setApiKey } = useAppStore()
  const [tab,           setTab]           = useState<Tab>('api')
  const [keyInput,      setKeyInput]      = useState(apiKey)
  const [showKey,       setShowKey]       = useState(false)
  const [keySaved,      setKeySaved]      = useState(false)
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [courses,       setCourses]       = useState<LocalCourse[]>(loadCourses)

  const iconFileRef = useRef<HTMLInputElement>(null)
  const [profileIcon, setProfileIcon]   = useState<string | null>(loadProfileIcon)

  // ── OpenClaw state ──
  const [ocInstalled,  setOcInstalled]  = useState(false)
  const [ocRunning,    setOcRunning]    = useState(false)
  const [ocChecking,   setOcChecking]   = useState(false)
  const [ocInstalling, setOcInstalling] = useState(false)
  const [ocStarting,   setOcStarting]   = useState(false)
  const [ocLog,        setOcLog]        = useState('')

  const isElectron = typeof window !== 'undefined' && !!window.seniorPartner

  async function checkOcStatus() {
    if (!isElectron) return
    setOcChecking(true)
    const { installed, running } = await window.seniorPartner!.openClawStatus()
    setOcInstalled(installed)
    setOcRunning(running)
    setOcChecking(false)
  }

  useEffect(() => {
    if (tab === 'integrations') checkOcStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    if (!isElectron) return
    // Register once — ipcRenderer.on accumulates listeners so no teardown needed
    // across renders; the listener persists for the lifetime of the window.
    window.seniorPartner!.onOpenClawProgress((chunk: string) => {
      setOcLog((prev) => prev + chunk)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOcInstall() {
    if (!isElectron) return
    setOcInstalling(true)
    setOcLog('')
    const result = await window.seniorPartner!.openClawInstall()
    setOcInstalling(false)
    await checkOcStatus()
    if (!result.success) setOcLog((prev) => prev + `\n\nExit code non-zero. Review output above.`)
  }

  async function handleOcStartGateway() {
    if (!isElectron) return
    setOcStarting(true)
    const result = await window.seniorPartner!.openClawStartGateway()
    setOcRunning(result.success)
    setOcStarting(false)
  }

  const handleAddCourse = useCallback((c: LocalCourse) => {
    setCourses((prev) => {
      const next = [...prev, c]
      saveCourses(next)
      return next
    })
  }, [])

  const handleDeleteCourse = useCallback((id: string) => {
    setCourses((prev) => {
      const next = prev.filter((c) => c.id !== id)
      saveCourses(next)
      return next
    })
  }, [])

  function handleIconUpload(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      saveProfileIcon(dataUrl)
      setProfileIcon(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  function saveKey() {
    setApiKey(keyInput.trim())
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2500)
  }

  const TABS: { value: Tab; label: string; icon: string }[] = [
    { value: 'api',          label: 'API',          icon: 'key'               },
    { value: 'courses',      label: 'Courses',      icon: 'school'            },
    { value: 'profile',      label: 'Profile',      icon: 'person'            },
    { value: 'integrations', label: 'Integrations', icon: 'hub'               },
    { value: 'preferences',  label: 'Preferences',  icon: 'tune'              },
  ]

  return (
    <>
      {showAddCourse && <AddCourseModal onAdd={handleAddCourse} onClose={() => setShowAddCourse(false)} />}

      <div className="p-8 max-w-4xl mx-auto space-y-8">
        <div>
          <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">Configuration</span>
          <h1 className="text-4xl font-serif mt-1 text-primary">Settings</h1>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-wider transition-all ${
                tab === t.value
                  ? 'bg-surface-container-lowest text-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* API tab */}
        {tab === 'api' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-6">
            <h2 className="font-serif text-2xl text-primary">Anthropic API Key</h2>
            <p className="text-sm text-on-surface-variant">
              Your API key is stored locally in your browser — it never touches any server. All Claude calls are made directly from your browser.
            </p>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">API Key</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="sk-ant-api03-…"
                    className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all pr-10"
                  />
                  <button
                    onClick={() => setShowKey((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-base">{showKey ? 'visibility_off' : 'visibility'}</span>
                  </button>
                </div>
                <button
                  onClick={saveKey}
                  className="py-3 px-6 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  {keySaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
              {keyInput && (
                <p className="text-[10px] text-on-surface-variant mt-2">
                  Key status: <span className="text-primary font-bold">{keyInput.startsWith('sk-ant-') ? '✓ Valid format' : '⚠ Expected format: sk-ant-…'}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Courses tab */}
        {tab === 'courses' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-primary">Your Courses</h2>
              <button
                onClick={() => setShowAddCourse(true)}
                className="flex items-center gap-2 py-2 px-5 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Add Course
              </button>
            </div>

            {courses.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl text-outline-variant">school</span>
                <p className="text-sm">No courses yet. Add your first course to start tracking.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {courses.map((c) => (
                  <div key={c.id} className="flex items-center gap-4 p-4 bg-surface-container-low rounded-xl">
                    <span className="material-symbols-outlined text-primary">school</span>
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-on-surface">{c.name}</p>
                      <p className="text-xs text-on-surface-variant">
                        {c.professor && `${c.professor} · `}{c.semester}{c.exam_date && ` · Exam: ${c.exam_date}`}
                      </p>
                    </div>
                    <button
                      onClick={() => { if (confirm(`Delete "${c.name}"?`)) handleDeleteCourse(c.id) }}
                      className="text-on-surface-variant hover:text-error transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-6">
            <h2 className="font-serif text-2xl text-primary">Profile</h2>

            {/* Profile icon */}
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-primary/20 bg-surface-container-low flex items-center justify-center shrink-0">
                {profileIcon
                  ? <img src={profileIcon} alt="Profile" className="w-full h-full object-cover" />
                  : <span className="material-symbols-outlined text-4xl text-on-surface-variant">person</span>
                }
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-on-surface">Profile Photo</p>
                <input ref={iconFileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { if (e.target.files?.[0]) handleIconUpload(e.target.files[0]) }} />
                <div className="flex gap-2">
                  <button
                    onClick={() => iconFileRef.current?.click()}
                    className="py-2 px-4 bg-primary text-on-primary rounded-full text-xs font-bold hover:opacity-90 transition-opacity"
                  >
                    Upload Photo
                  </button>
                  {profileIcon && (
                    <button
                      onClick={() => { clearProfileIcon(); setProfileIcon(null) }}
                      className="py-2 px-4 border border-outline-variant rounded-full text-xs font-bold text-on-surface-variant hover:text-error transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-on-surface-variant">Stored locally in your browser.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              {[
                { label: 'Full Name',     placeholder: 'Bianna'                    },
                { label: 'School',        placeholder: 'St. Thomas University SOL'  },
                { label: 'Year',          placeholder: '1L'                         },
                { label: 'Email',         placeholder: 'bianna@saintthomas.edu'     },
              ].map(({ label, placeholder }) => (
                <div key={label}>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">{label}</label>
                  <input
                    placeholder={placeholder}
                    className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all"
                  />
                </div>
              ))}
            </div>
            <button className="py-3 px-6 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity">
              Save Profile
            </button>
          </div>
        )}

        {/* Integrations tab */}
        {tab === 'integrations' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-8">
            <div>
              <h2 className="font-serif text-2xl text-primary">Integrations</h2>
              <p className="text-sm text-on-surface-variant mt-1">Connect external tools to extend the app's capabilities.</p>
            </div>

            {/* OpenClaw card */}
            <div className="border border-outline-variant/20 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-6 bg-surface-container-low">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary">hub</span>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-on-surface">OpenClaw</p>
                    <p className="text-[10px] text-on-surface-variant">Local AI gateway with persistent memory · port 18789</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    ocInstalled ? 'bg-primary-fixed text-on-primary-container' : 'bg-surface-container text-on-surface-variant'
                  }`}>
                    {ocInstalled ? '✓ Installed' : 'Not installed'}
                  </span>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                    ocRunning ? 'bg-tertiary-fixed/60 text-on-tertiary-container' : 'bg-surface-container text-on-surface-variant'
                  }`}>
                    {ocRunning ? '● Gateway running' : '○ Gateway stopped'}
                  </span>
                  <button
                    onClick={checkOcStatus}
                    disabled={ocChecking}
                    className="p-1.5 text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
                    title="Refresh status"
                  >
                    <span className={`material-symbols-outlined text-base ${ocChecking ? 'animate-spin' : ''}`}>refresh</span>
                  </button>
                </div>
              </div>

              {/* Feature list */}
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: 'psychology', label: 'Persistent Memory', desc: 'Remembers your study history, weak spots, professor quirks across every session' },
                    { icon: 'forum',      label: 'Multi-Channel Access', desc: 'Chat with your AI via WhatsApp, Telegram, Discord, iMessage — anywhere' },
                    { icon: 'extension', label: 'Skills & Tools', desc: 'Legal research skills, Westlaw lookups, case law browsing via browser control' },
                    { icon: 'memory',    label: 'Local & Private', desc: 'Runs entirely on your machine — no data leaves your computer' },
                  ].map(({ icon, label, desc }) => (
                    <div key={label} className="flex gap-3 p-3 bg-surface-container-low rounded-lg">
                      <span className="material-symbols-outlined text-primary text-base mt-0.5 shrink-0">{icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-on-surface">{label}</p>
                        <p className="text-[10px] text-on-surface-variant leading-relaxed mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                {!isElectron ? (
                  <p className="text-xs text-on-surface-variant italic">OpenClaw integration requires the desktop app.</p>
                ) : (
                  <div className="flex gap-3 flex-wrap">
                    {!ocInstalled && (
                      <button
                        onClick={handleOcInstall}
                        disabled={ocInstalling}
                        className="flex items-center gap-2 py-2.5 px-5 bg-primary text-on-primary rounded-full text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">{ocInstalling ? 'hourglass_empty' : 'download'}</span>
                        {ocInstalling ? 'Installing…' : 'Install OpenClaw'}
                      </button>
                    )}
                    {ocInstalled && !ocRunning && (
                      <button
                        onClick={handleOcStartGateway}
                        disabled={ocStarting}
                        className="flex items-center gap-2 py-2.5 px-5 bg-tertiary text-on-tertiary rounded-full text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-sm">{ocStarting ? 'hourglass_empty' : 'play_arrow'}</span>
                        {ocStarting ? 'Starting…' : 'Start Gateway'}
                      </button>
                    )}
                    {ocRunning && (
                      <div className="flex items-center gap-2 py-2.5 px-5 bg-primary-fixed/30 rounded-full text-xs font-bold text-on-primary-container">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Persistent memory active in Study Sessions
                      </div>
                    )}
                  </div>
                )}

                {/* Install progress log */}
                {ocLog && (
                  <div className="bg-[#0d1117] rounded-lg p-4 font-mono text-[10px] text-green-400 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {ocLog}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Preferences tab */}
        {tab === 'preferences' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-6">
            <h2 className="font-serif text-2xl text-primary">Preferences</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Default Subject</label>
                <select className="bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all">
                  <option>Contracts</option>
                  <option>Torts</option>
                  <option>Civ Pro</option>
                  <option>Con Law</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Default Outline Mode</label>
                <select className="bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all">
                  <option>Full Outline</option>
                  <option>Case Brief</option>
                  <option>IRAC Memo</option>
                  <option>Flash Cards</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
