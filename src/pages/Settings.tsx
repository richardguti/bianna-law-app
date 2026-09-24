import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'
import { loadCourses, saveCourses, loadProfileIcon, saveProfileIcon, clearProfileIcon, type LocalCourse } from '../lib/courses'
import {
  DEFAULT_PREFS, setTheme, resolvePalette, contrastRatio, readableOn, isValidHex, normaliseHex, type UiPrefs,
} from '../lib/theme'

const SEMESTERS = [
  'Spring 2026', 'Fall 2026',
  'Spring 2027', 'Fall 2027',
  'Spring 2028', 'Fall 2028',
  'Spring 2029', 'Fall 2029',
  'Spring 2030', 'Fall 2030',
]

const COURSE_EXTRACT_SYSTEM = 'You extract law school course information from syllabus text. Respond ONLY with valid JSON, no markdown: {"name":"full course name","professor":"Prof. Last Name or empty string","exam_date":"YYYY-MM-DD or empty string","semester":"Season YYYY e.g. Spring 2026"}'

/* Answering-model choices. DeepSeek's API has had congestion outages, so the model
   is switchable at runtime rather than only in code. */
const MODEL_CHOICES: { value: 'reasoner' | 'chat' | 'gemini'; label: string; desc: string }[] = [
  { value: 'reasoner', label: 'DeepSeek R1',    desc: 'Deepest reasoning, with a visible chain-of-thought trace. Slowest. If R1 reasons but returns no final answer, the app auto-formats it with DeepSeek V3.' },
  { value: 'chat',     label: 'DeepSeek V3',    desc: 'Fast and highly stable at strict formatting — the fallback when R1 is congested or for JSON-heavy work.' },
  { value: 'gemini',   label: 'Gemini 1.5 Pro', desc: 'A separate provider, so the app keeps answering if api.deepseek.com is down.' },
]

/* Customisable palette entries (Appearance tab). */
type ColorKey = 'background' | 'surface' | 'primary' | 'text'

const COLOR_FIELDS: { key: ColorKey; label: string; hint: string }[] = [
  { key: 'background', label: 'Background',     hint: 'App backdrop' },
  { key: 'surface',    label: 'Surface',        hint: 'Cards & panels' },
  { key: 'primary',    label: 'Primary Accent', hint: 'Buttons & highlights' },
  { key: 'text',       label: 'Text',           hint: 'Body copy' },
]

const THEME_CHOICES: { value: UiPrefs['theme']; label: string; icon: string }[] = [
  { value: 'light',  label: 'Light',  icon: 'light_mode' },
  { value: 'dark',   label: 'Dark',   icon: 'dark_mode' },
  { value: 'system', label: 'System', icon: 'contrast' },
]

type Tab = 'api' | 'courses' | 'profile' | 'appearance' | 'preferences' | 'integrations'

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

  /** Send extracted syllabus text to DeepSeek R1 and prefill the form from its JSON reply. */
  async function extractCourseInfo(syllabusText: string) {
    const resp = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: claudeHeaders(apiKey),
      body: JSON.stringify({
        model:      'deepseek-reasoner',
        max_tokens: 2048,
        messages:   [
          { role: 'system', content: COURSE_EXTRACT_SYSTEM },
          { role: 'user',   content: `Extract the course details from this syllabus text.\n\n${syllabusText}` },
        ],
      }),
    })
    const json = await resp.json()
    if (!resp.ok || json.error) throw new Error(json.error?.message ?? `API error ${resp.status}`)
    const raw = json.choices?.[0]?.message?.content ?? ''
    const s   = raw.indexOf('{'), e = raw.lastIndexOf('}')
    if (s < 0 || e < s) throw new Error('DeepSeek R1 returned an unexpected format — could not parse course info.')
    const parsed = JSON.parse(raw.slice(s, e + 1))
    if (parsed.name)       setName(parsed.name)
    if (parsed.professor)  setProfessor(parsed.professor)
    if (parsed.exam_date)  setExamDate(parsed.exam_date)
    if (parsed.semester && SEMESTERS.includes(parsed.semester)) setSemester(parsed.semester)
  }

  async function handleCapture(file: File) {
    if (!apiKey) { setScanError('Add your DeepSeek API key in the API tab first.'); return }
    setScanning(true)
    setScanError(null)
    setPreviewUrl(null)

    try {
      // DeepSeek R1 (deepseek-reasoner) is a text-only reasoning model with no
      // vision input, so images are steered to a text-extractable attachment.
      if (file.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(file))
        throw new Error('DeepSeek R1 is text-only and cannot read images. Attach the syllabus as a PDF, DOCX, or TXT file — or type the details below.')
      }
      if (/\.(pdf|docx)$/i.test(file.name) && window.seniorPartner?.pickAndReadFile) {
        throw new Error('Use the “Attach PDF / DOCX Syllabus” button so the document text can be extracted first.')
      }
      await extractCourseInfo(`[Syllabus file: ${file.name}]\n\n${await file.text()}`)
    } catch (err) {
      setScanError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  /** Electron only: native picker → pdf-parse / mammoth text extraction → DeepSeek R1. */
  async function handleAttachDocument() {
    if (!apiKey) { setScanError('Add your DeepSeek API key in the API tab first.'); return }
    setScanning(true)
    setScanError(null)
    try {
      const result = await window.seniorPartner!.pickAndReadFile()
      if (result.canceled) return
      if (!result.success || !result.text) throw new Error(result.error ?? 'Could not read that document.')
      await extractCourseInfo(`[Syllabus file: ${result.fileName}]\n\n${result.text}`)
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
      <div className="bg-surface-container-lowest w-full max-w-lg rounded-xl shadow-[var(--shadow-modal)] overflow-hidden border border-outline-variant/20">
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

          {/* Syllabus auto-fill — DeepSeek R1 reads extracted text (no vision input) */}
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.pdf,.docx,image/*" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleCapture(e.target.files[0]) }} />
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors text-sm font-bold disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">{scanning ? 'hourglass_empty' : 'upload_file'}</span>
              {scanning ? 'Reading syllabus…' : 'Attach Syllabus (TXT / MD)'}
            </button>
            {typeof window !== 'undefined' && !!window.seniorPartner?.pickAndReadFile && (
              <button
                type="button"
                onClick={handleAttachDocument}
                disabled={scanning}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors text-sm font-bold disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
                Attach PDF / DOCX Syllabus
              </button>
            )}
          </div>
          <p className="text-[11px] text-on-surface-variant mb-4 leading-relaxed">
            Syllabus auto-fill runs on DeepSeek R1 (<code className="bg-surface-container px-1 py-0.5 rounded text-[10px]">deepseek-reasoner</code>), a text-only reasoning model — PDF, DOCX, TXT and MD files are read directly; photographs must be converted to text first.
          </p>
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
                className="flex-1 bg-surface-container-lowest text-primary border border-outline-variant/30 rounded-full py-3 font-bold text-sm hover:bg-surface-container-low transition-all">
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
  const [testing,       setTesting]       = useState(false)
  const [testResult,    setTestResult]    = useState<{ ok: boolean; message: string } | null>(null)
  const [modelPref,     setModelPref]     = useState<'reasoner' | 'chat' | 'gemini'>('reasoner')

  // ── ICM (mirrored study corpus) state ──
  const [icmStats,   setIcmStats]   = useState<IcmStats>({ files: 0, byDiscipline: {}, byDocType: {} })
  const [icmSyncing, setIcmSyncing] = useState(false)
  const [icmMsg,     setIcmMsg]     = useState<string | null>(null)

  async function refreshIcmStats() {
    const s = await window.seniorPartner?.icmStats?.()
    if (s) setIcmStats(s)
  }

  const [icmVerifyResult, setIcmVerifyResult] = useState<string | null>(null)

  async function handleIcmVerify() {
    const res = await window.seniorPartner?.icmVerify?.({ query: 'minimum contacts' })
    if (!res || !res.success) { setIcmVerifyResult('ICM verification is only available in the desktop app.'); return }
    const matched = (res.matched ?? []).map((m) => m.rel).join(', ') || '(no matches)'
    setIcmVerifyResult(
      `Query "${res.query}" → ${res.filesIndexed} indexed · matched: ${matched} · injected ${res.injectedBlockLength} chars ${res.blockOrderedBeforeRag ? 'before the generic RAG block' : ''}`
    )
  }

  async function handleIcmSync(root?: string) {
    setIcmSyncing(true)
    setIcmMsg(null)
    try {
      const res = await window.seniorPartner?.icmSync?.(root ? { root } : {})
      if (!res) { setIcmMsg('ICM is only available in the desktop app.'); return }
      if (res.canceled) return
      if (res.error) { setIcmMsg(`Indexing failed: ${res.error}`); return }
      if (res.stats) setIcmStats(res.stats)
      setIcmMsg(`Indexed ${res.indexed} file${res.indexed === 1 ? '' : 's'} (${res.added} new, ${res.updated} updated, ${res.reused} unchanged).`)
    } finally {
      setIcmSyncing(false)
    }
  }

  async function handleIcmChooseRoot() {
    setIcmSyncing(true)
    setIcmMsg(null)
    try {
      const res = await window.seniorPartner?.icmChooseRoot?.()
      if (!res || res.canceled) return
      if (res.error) { setIcmMsg(`Indexing failed: ${res.error}`); return }
      if (res.stats) setIcmStats(res.stats)
      setIcmMsg(`Mirrored and indexed ${res.indexed} file${res.indexed === 1 ? '' : 's'}.`)
    } finally {
      setIcmSyncing(false)
    }
  }

  // Load the stored answering-model preference (R1 / V3 / Gemini failover).
  useEffect(() => {
    window.seniorPartner?.getModelPreference?.()
      .then((pref) => { if (pref) setModelPref(pref) })
      .catch(() => { /* keep default */ })
  }, [])

  function changeModel(pref: 'reasoner' | 'chat' | 'gemini') {
    setModelPref(pref)
    window.seniorPartner?.setModelPreference?.(pref)
  }
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [courses,       setCourses]       = useState<LocalCourse[]>(loadCourses)

  const iconFileRef = useRef<HTMLInputElement>(null)
  const [profileIcon, setProfileIcon]   = useState<string | null>(loadProfileIcon)

  const profile     = useAppStore((s) => s.profile)
  const setProfile  = useAppStore((s) => s.setProfile)
  const [pfName,    setPfName]    = useState(profile.name)
  const [pfSchool,  setPfSchool]  = useState(profile.school)
  const [pfYear,    setPfYear]    = useState(profile.year)
  const [pfEmail,   setPfEmail]   = useState(profile.email)
  const [savedToast, setSavedToast] = useState(false)

  async function saveProfile() {
    const next = { name: pfName, school: pfSchool, year: pfYear, email: pfEmail, photoBase64: profileIcon }
    setProfile(next)
    try {
      const res = await window.seniorPartner?.profileSave?.(next)
      if (res && !res.success) { setSavedToast(false); return }
    } catch { /* web dev — local state already updated */ }
    setSavedToast(true)
    setTimeout(() => setSavedToast(false), 2200)
  }


  useEffect(() => {
    if (tab === 'integrations') refreshIcmStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ── Appearance: theme + palette ────────────────────────────────────────────
  const [uiPrefs,  setUiPrefs]  = useState<UiPrefs>(DEFAULT_PREFS)
  const [hexDraft, setHexDraft] = useState<Partial<Record<ColorKey, string>>>({})

  useEffect(() => {
    window.seniorPartner?.getUiPreferences?.()
      .then((p) => { if (p) { setUiPrefs(p); setTheme(p) } })
      .catch(() => { /* keep defaults */ })
  }, [])

  /** Apply immediately (live preview) and persist. `null` restores the default. */
  function updatePrefs(patch: Partial<UiPrefs>) {
    const next = { ...uiPrefs, ...patch }
    setUiPrefs(next)
    setTheme(next)
    window.seniorPartner?.setUiPreferences?.(patch)
  }

  function resetAppearance() {
    setUiPrefs(DEFAULT_PREFS)
    setHexDraft({})
    setTheme(DEFAULT_PREFS)
    window.seniorPartner?.resetUiPreferences?.()
  }

  function onHexInput(key: ColorKey, value: string) {
    setHexDraft((d) => ({ ...d, [key]: value }))
    if (isValidHex(value)) updatePrefs({ [key]: normaliseHex(value) })
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
    const trimmed = keyInput.trim()
    setApiKey(trimmed)
    window.seniorPartner?.apiKeySave?.(trimmed)
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2500)
  }

  /** Live round-trip against DeepSeek R1 to confirm the key and endpoint work. */
  async function testConnection() {
    const key = keyInput.trim()
    if (!key) { setTestResult({ ok: false, message: 'Enter a key first.' }); return }
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: claudeHeaders(key),
        body: JSON.stringify({
          model:      'deepseek-reasoner',
          max_tokens: 256,
          messages:   [{ role: 'user', content: 'Reply with the single word: ready' }],
        }),
      })
      const data = await resp.json()
      if (!resp.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${resp.status}`)
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) throw new Error('Connected, but DeepSeek R1 returned an empty answer. Try again.')
      setTestResult({
        ok: true,
        message: `DeepSeek R1 connected ✓ (model: ${data.model ?? 'deepseek-reasoner'})`,
      })
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const TABS: { value: Tab; label: string; icon: string }[] = [
    { value: 'api',          label: 'API',          icon: 'key'               },
    { value: 'courses',      label: 'Courses',      icon: 'school'            },
    { value: 'profile',      label: 'Profile',      icon: 'person'            },
    { value: 'appearance',   label: 'Appearance',   icon: 'palette'           },
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
            <h2 className="font-serif text-2xl text-primary">DeepSeek API Key</h2>
            <p className="text-sm text-on-surface-variant">
              Your API key is stored locally in your browser and app storage. All calls use the DeepSeek R1 reasoning model (<code className="bg-surface-container px-1 py-0.5 rounded text-xs">deepseek-reasoner</code>) for deep legal reasoning, IRAC analysis, and syllabus structuring.
            </p>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">DeepSeek API Key (R1 Reasoner)</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="sk-…"
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
                <button
                  onClick={testConnection}
                  disabled={testing}
                  className="py-3 px-6 bg-tertiary-container text-on-tertiary-container rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test'}
                </button>
              </div>
              {keyInput && (
                <p className="text-[10px] text-on-surface-variant mt-2">
                  Key status: <span className="text-primary font-bold">{keyInput.startsWith('sk-') ? '✓ Valid format (DeepSeek)' : '⚠ Expected format: sk-…'}</span>
                </p>
              )}
              {testResult && (
                <p className={`text-[11px] mt-2 rounded-lg px-3 py-2 ${testResult.ok ? 'text-primary bg-primary/5' : 'text-error bg-error-container'}`}>
                  {testResult.message}
                </p>
              )}
            </div>

            {/* Answering model — R1 / V3 / Gemini failover */}
            <div className="pt-6 border-t border-outline-variant/10">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">
                Answering Model
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                {MODEL_CHOICES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => changeModel(m.value)}
                    className={`flex-1 rounded-xl px-4 py-3 text-left border transition-all ${
                      modelPref === m.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-outline-variant/20 text-on-surface-variant hover:border-primary/40'
                    }`}
                  >
                    <span className="block text-xs font-bold">{m.label}</span>
                    {modelPref === m.value && (
                      <span className="material-symbols-outlined text-sm align-middle">check_circle</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-on-surface-variant mt-2 leading-relaxed">
                {MODEL_CHOICES.find((m) => m.value === modelPref)?.desc}
              </p>
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
                { label: 'Full Name', value: pfName,   set: setPfName,   placeholder: 'Bianna'                    },
                { label: 'School',    value: pfSchool, set: setPfSchool, placeholder: 'St. Thomas University SOL'  },
                { label: 'Year',      value: pfYear,   set: setPfYear,   placeholder: '1L'                         },
                { label: 'Email',     value: pfEmail,  set: setPfEmail,  placeholder: 'bianna@saintthomas.edu'     },
              ].map(({ label, value, set, placeholder }) => (
                <div key={label}>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">{label}</label>
                  <input
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-all"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveProfile}
                className="py-3 px-6 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
              >
                Save Profile
              </button>
              {savedToast && (
                <span className="text-xs font-semibold text-primary animate-pulse">✓ Saved</span>
              )}
            </div>
          </div>
        )}

        {/* Integrations tab */}
        {tab === 'integrations' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-8">
            <div>
              <h2 className="font-serif text-2xl text-primary">Integrations</h2>
              <p className="text-sm text-on-surface-variant mt-1">Connect external tools to extend the app's capabilities.</p>
            </div>

            {/* ICM — the student's own materials as an internal corpus */}
            <div className="border border-outline-variant/20 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-6 bg-surface-container-low">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary">library_books</span>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-on-surface">Study Corpus (ICM)</p>
                    <p className="text-xs text-on-surface-variant">
                      Mirrors your own law files and reasons over them first.
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                  icmStats.files > 0 ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {icmStats.files > 0 ? `${icmStats.files} indexed` : 'Not indexed'}
                </span>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  ICM keeps an index of your own materials (outlines, briefs, notes, syllabi, exams) and feeds the
                  most relevant passages into every answer, so the AI reasons from <em>your</em> casebook and
                  professor&apos;s emphasis rather than generic doctrine. Files are labelled by legal discipline and
                  document type straight from their names and folder paths.
                </p>

                {icmStats.files > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(icmStats.byDiscipline).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => (
                        <span key={k} className="text-[10px] font-label uppercase tracking-wider px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant">
                          {k.replace('_', ' ')} · {n}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(icmStats.byDocType).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => (
                        <span key={k} className="text-[10px] font-label px-2 py-1 rounded border border-outline-variant/30 text-on-surface-variant">
                          {k.replace('_', ' ')} · {n}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-on-surface-variant">
                      {Math.round((icmStats.indexedChars ?? 0) / 1000).toLocaleString()}k characters searchable
                      {icmStats.updatedAt ? ` · last synced ${new Date(icmStats.updatedAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleIcmChooseRoot}
                    disabled={icmSyncing}
                    className="py-2.5 px-5 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    {icmSyncing ? 'Indexing…' : 'Mirror a folder'}
                  </button>
                  <button
                    onClick={() => handleIcmSync()}
                    disabled={icmSyncing}
                    className="py-2.5 px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
                  >
                    Re-scan Documents/Bianna_Law
                  </button>
                  <button
                    onClick={() => window.seniorPartner?.openDocumentsFolder?.()}
                    className="py-2.5 px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 transition-colors"
                  >
                    Open folder
                  </button>
                  <button
                    onClick={handleIcmVerify}
                    className="py-2.5 px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 transition-colors"
                  >
                    Test retrieval
                  </button>
                </div>
                {icmVerifyResult && (
                  <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2 leading-relaxed">
                    {icmVerifyResult}
                  </p>
                )}

                {icmMsg && (
                  <p className="text-[11px] text-primary bg-primary/5 rounded-lg px-3 py-2">{icmMsg}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Appearance tab — theme + palette with WCAG contrast feedback */}
        {tab === 'appearance' && (() => {
          const palette   = resolvePalette(uiPrefs, window.seniorPartner?.prefersDark?.() ?? false)
          const onPrimary = readableOn(palette.primary)
          const pairs = [
            { label: 'Text on background', ratio: contrastRatio(palette.text, palette.background) },
            { label: 'Text on primary',    ratio: contrastRatio(onPrimary, palette.primary) },
          ]
          const pill = (ratio: number) =>
            ratio >= 4.5 ? 'bg-primary-fixed text-on-primary-container'
              : ratio >= 3 ? 'bg-tertiary-fixed/70 text-on-tertiary-container'
                : 'bg-error-container text-on-error-container'

          return (
            <div className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10 shadow-[var(--shadow-sm)] space-y-8">
              <div>
                <h2 className="font-serif text-2xl text-primary">Appearance</h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Changes apply live and are remembered on this machine.
                </p>
              </div>

              {/* Theme */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Theme</label>
                <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
                  {THEME_CHOICES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => updatePrefs({ theme: t.value })}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-wider transition-all ${
                        uiPrefs.theme === t.value
                          ? 'bg-surface-container-lowest text-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Palette */}
              <div className="space-y-4">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Colors</label>
                {COLOR_FIELDS.map((f) => {
                  const effective = palette[f.key]
                  const shown = hexDraft[f.key] ?? effective
                  return (
                    <div key={f.key} className="flex items-center gap-3 flex-wrap">
                      <input
                        type="color"
                        aria-label={`${f.label} color`}
                        value={effective}
                        onChange={(e) => { setHexDraft((d) => ({ ...d, [f.key]: e.target.value })); updatePrefs({ [f.key]: e.target.value }) }}
                        className="w-11 h-11 rounded-lg border border-outline-variant/30 cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        aria-label={`${f.label} hex value`}
                        value={shown}
                        onChange={(e) => onHexInput(f.key, e.target.value)}
                        spellCheck={false}
                        className="w-32 bg-surface-container-low rounded-lg px-3 py-2.5 text-xs font-mono outline-none border border-outline-variant/20 focus:border-primary transition-all"
                      />
                      <div className="flex-1 min-w-[8rem]">
                        <p className="text-xs font-semibold text-on-surface">{f.label}</p>
                        <p className="text-[10px] text-on-surface-variant">{f.hint}</p>
                      </div>
                      {uiPrefs[f.key] !== null && (
                        <button
                          onClick={() => { setHexDraft((d) => ({ ...d, [f.key]: undefined })); updatePrefs({ [f.key]: null }) }}
                          className="text-[10px] font-label uppercase tracking-wider text-on-surface-variant hover:text-primary"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>


              {/* Contrast feedback (WCAG AA) */}
              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Contrast</label>
                {pairs.map((p) => (
                  <div key={p.label} className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${pill(p.ratio)}`}>
                      {p.ratio.toFixed(2)}:1
                    </span>
                    <span className="text-xs text-on-surface-variant">
                      {p.label}
                      {p.ratio < 4.5 && <span className="ml-2 text-error">below the 4.5:1 AA minimum</span>}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-on-surface-variant">
                  Warnings are advisory — your text may still be legible, but WCAG AA asks for at least 4.5:1.
                </p>
              </div>

              <div className="pt-2 border-t border-outline-variant/10">
                <button
                  onClick={resetAppearance}
                  className="py-2.5 px-5 rounded-full text-xs font-label font-bold uppercase tracking-widest border border-outline-variant/30 text-on-surface-variant hover:border-primary/40 transition-colors"
                >
                  Reset to defaults
                </button>
              </div>
            </div>
          )
        })()}

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
