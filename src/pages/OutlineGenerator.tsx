import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, isSupabaseConfigured } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { streamAi } from '../lib/aiStream'
import { EditableChipGroup } from '../components/EditableChipGroup'
import { EDITABLE_STORAGE_KEYS } from '../lib/editableFields'
import type { DocumentSubject, DocumentMode } from '../types/database'

/* ─── Constants ──────────────────────────────────────────────────────────── */
const SUBJECTS: { value: DocumentSubject; label: string }[] = [
  { value: 'contracts',      label: 'Contracts'   },
  { value: 'torts',          label: 'Torts'        },
  { value: 'civ_pro',        label: 'Civ Pro'      },
  { value: 'constitutional', label: 'Con Law'      },
  { value: 'property',       label: 'Property'     },
  { value: 'wills_trusts',   label: 'Wills & Trust'},
  { value: 'other',          label: 'Other'        },
]

const MODES: { value: DocumentMode; label: string; icon: string; desc: string }[] = [
  { value: 'full_outline',    label: 'Analytical',      icon: 'list_alt',      desc: 'Deep legal hierarchy for complex briefs.' },
  { value: 'case_brief',      label: 'Case Brief',      icon: 'gavel',         desc: 'Citation, Facts, Issue, Holding, Rule of Law.' },
  { value: 'irac_memo',       label: 'IRAC Memo',       icon: 'article',       desc: 'Issue, Rule, Application, Conclusion.' },
  { value: 'checklist_audit', label: 'Checklist Audit', icon: 'fact_check',    desc: 'Gap analysis against your outlines.' },
  { value: 'flash_card',      label: 'Flash Cards',     icon: 'bolt',          desc: 'Spaced-repetition optimized points.' },
  { value: 'custom',          label: 'Custom',          icon: 'edit_note',     desc: 'Free-form — describe exactly what you need.' },
]

const TOPIC_CHIPS: Record<DocumentSubject, string[]> = {
  property: [
    'Fee Simple Absolute', 'Life Estate', 'Fee Tail', 'Defeasible Fees',
    'Future Interests', 'Rule Against Perpetuities', 'Adverse Possession',
    'Easements', 'Covenants Running with the Land', 'Equitable Servitudes',
    'Landlord-Tenant', 'Concurrent Ownership', 'Tenancy in Common',
    'Joint Tenancy', 'Recording Acts', 'Bona Fide Purchaser',
  ],
  contracts: [
    'Objective Theory', 'Offer & Revocation', 'Mirror Image Rule', 'UCC § 2-207',
    'Firm Offer UCC § 2-205', 'Consideration & Forbearance', 'Promissory Estoppel § 90',
    'Mutual Assent', 'Option Contracts', 'Mailbox Rule', 'Misunderstanding Rule § 201',
    'Pre-Existing Duty Rule', 'Parol Evidence Rule', 'Statute of Frauds',
  ],
  torts: [
    'Battery Elements', 'Assault Elements', 'False Imprisonment', 'Hand Formula B<PL',
    'Negligence Full Framework', 'Reasonable Person Standard', 'Actual vs Proximate Cause',
    'Self-Defense Privilege', 'Consent Defense', 'Strict Liability',
    'Products Liability', 'Defenses & Privileges',
  ],
  civ_pro: [
    'Federal Question § 1331', 'Diversity Jurisdiction § 1332', 'Supplemental Jurisdiction § 1367',
    'General vs Specific Jurisdiction', 'Minimum Contacts — Int\'l Shoe', 'Purposeful Availment',
    'Well-Pleaded Complaint Rule', 'Venue § 1391', 'Transfer of Venue § 1404',
    'Erie Doctrine', 'Complete Diversity', 'Essentially at Home Test',
  ],
  constitutional: [
    'Commerce Clause', 'Due Process (5th & 14th)', 'Equal Protection', 'First Amendment',
    'Standing Doctrine', 'Rational Basis Review', 'Strict Scrutiny', 'Spending Power',
  ],
  wills_trusts: [
    'Intestacy & Per Stirpes', 'Will Execution Formalities', 'Testamentary Capacity',
    'Undue Influence & Duress', 'Revocation & Revival', 'Lapse & Antilapse',
    'Ademption & Abatement', 'Elective Share', 'Homestead Protection',
    'Revocable vs Irrevocable Trusts', 'Spendthrift Trusts', 'Trustee Duties & Powers',
    'Rule Against Perpetuities (Trusts)', 'Cy Pres Doctrine',
  ],
  other: [],
}

/* ─── System prompt (Bia style) ──────────────────────────────────────────── */
const BIA_SYSTEM = `You are the Senior Law Partner, a specialized AI legal study assistant for Bianna, a 1L at St. Thomas University School of Law in Miami, FL.

EXPERTISE: IRAC and CREAC methodology, Common Law vs. UCC Article 2, intentional torts, negligence (Hand Formula B < P × L), personal jurisdiction (minimum contacts), subject matter jurisdiction, and all standard 1L doctrine.

HALLUCINATION GUARD: Never fabricate case citations or holdings. If a doctrine is outside provided course materials, state: "Outside provided course materials — verify with professor."

BIA STYLE OUTPUT: When generating outlines, use this exact four-tier HTML system. Output raw HTML only — no markdown fences, no preamble.
- Tier 1: <div style="color:#FFFFFF;background-color:#A4B491;padding:14px;text-align:center;font-family:sans-serif;letter-spacing:2px;font-weight:bold;margin-bottom:8px;font-size:14px;">TITLE</div>
- Tier 2: <div style="color:#000000;background-color:#EBEFE8;padding:9px 14px;margin-top:18px;font-family:sans-serif;letter-spacing:1px;font-size:12px;font-weight:600;">SECTION</div>
- Tier 3: <div style="border:1.5px solid #A4B491;padding:9px 11px;color:#A4B491;font-weight:bold;text-transform:uppercase;margin-top:22px;margin-bottom:10px;font-family:sans-serif;font-size:10px;letter-spacing:0.5px;">RULE</div>
- Tier 4: <strong> for rule definitions. <em><strong> for case citations. Star prefix ★ for Professor Hooks.`

export function OutlineGenerator() {
  const apiKey = useAppStore((s) => s.apiKey)
  const customSubject = useAppStore((s) => s.customSubject)
  const setCustomSubject = useAppStore((s) => s.setCustomSubject)
  // The Subject field's custom entry now lives inside EditableChipGroup, so the old
  // per-page editing flag is gone.


  const [subject,      setSubject]      = useState<DocumentSubject>('contracts')
  // The label actually sent to the model: the free-text course name when "Other"
  // is selected, otherwise the preset subject value.
  const subjectLabel = subject === 'other'
    ? (customSubject.trim() || 'Other')
    : (SUBJECTS.find((s) => s.value === subject)?.label ?? subject)
  const [modes,        setModes]        = useState<DocumentMode[]>(['full_outline'])
  const [topic,        setTopic]        = useState('')
  const [chips,        setChips]        = useState<string[]>([])
  const [customPrompt, setCustomPrompt] = useState('')   // free-form override

  // Single-mode accessor for Supabase save (primary mode)
  const primaryMode = modes[0] ?? 'full_outline'

  // Mode toggling now lives in EditableChipGroup. The generator still guarantees at
  // least one active mode, enforced where the change is applied.

  const [notes,        setNotes]        = useState(() => {
    const captured = sessionStorage.getItem('capture_notes')
    if (captured) { sessionStorage.removeItem('capture_notes'); return captured }
    return ''
  })
  const [attachedName,    setAttachedName]    = useState<string | null>(null)
  const [attachedData,    setAttachedData]    = useState<{ type: string; [k: string]: unknown } | null>(null)
  const [attachMsg,       setAttachMsg]       = useState<string | null>(null)
  const [output,          setOutput]          = useState<string | null>(null)
  const [saveMsg,         setSaveMsg]         = useState<string | null>(null)

  // ── Save fallback: format choice, then folder-or-Vault ───────────────────────
  // Opened whenever the cloud Vault cannot take the outline, and whenever the app is
  // asked to close with unsaved work. Word or PDF is preselected because a file is useful
  // in ways a database row is not: it can be printed, emailed or edited, and it can live
  // in whichever folder she actually wants.
  const [exportOpen,      setExportOpen]      = useState(false)
  const [exportFormat,    setExportFormat]    = useState<'docx' | 'pdf' | 'html'>('docx')
  const [exportBusy,      setExportBusy]      = useState(false)
  const [exportNote,      setExportNote]      = useState<string | null>(null)
  const [vaultTags,       setVaultTags]       = useState('')
  const [savedLocally,    setSavedLocally]    = useState(false)
  const [exitPrompt,      setExitPrompt]      = useState(false)
  const [lastUserContent, setLastUserContent] = useState<string | null>(null)
  // ── Live stream state: answer tokens + the model's reasoning trace ──
  const [streamBuffer,    setStreamBuffer]    = useState('')
  const [reasoning,       setReasoning]       = useState('')
  const [elapsed,         setElapsed]         = useState(0)

  // ── Unsaved-work tracking ────────────────────────────────────────────────────
  // The generator can hold tens of thousands of tokens of work. Anything rendered but not
  // yet stored anywhere is reported to the main process, which intercepts the first
  // close/quit and hands it back here instead of discarding it silently.
  function markUnsaved() { (window as any).seniorPartner?.setUnsaved?.(true) }
  function markSaved()   { (window as any).seniorPartner?.setUnsaved?.(false) }

  // A completed generation starts unsaved; storing it anywhere clears that.
  useEffect(() => {
    if (output) markUnsaved()
  }, [output])

  // The main process refused to close because work is unsaved. Ask, never discard.
  useEffect(() => {
    const bridge = window.seniorPartner
    bridge?.on?.('app:unsaved-exit', () => { setExitPrompt(true); setExportOpen(true) })
  }, [])

  /**
   * The route she chose: a real file in a folder she picks, or the in-app Vault.
   *
   * Both are offered because they solve different problems. A folder is for handing work
   * in, printing or editing. The Vault is for keeping work organised and tagged next to
   * everything else she has written.
   */
  async function exportOutline(destination: 'folder' | 'vault') {
    if (!output) return
    const sp = (window as any).seniorPartner
    const topicLabel = topic || chips[0] || 'Untitled'

    if (destination === 'vault') {
      // Already written by addToVault; reveal it so she can see where it went.
      setExportOpen(false)
      setSaveMsg('Kept in the app Vault \u2713')
      setTimeout(() => setSaveMsg(null), 4000)
      sp?.vaultOpenFolder?.()
      if (exitPrompt) { setExitPrompt(false); sp?.exitNow?.() }
      return
    }

    setExportBusy(true)
    try {
      const res = await sp?.exportDocument?.({
        topic:  topicLabel,
        subject,
        mode:   primaryMode,
        html:   output,
        format: exportFormat,
      })
      if (res?.success) {
        setSaveMsg('Saved to ' + res.filePath)
        markSaved()
        setExportOpen(false)
        setExportNote(null)
        if (exitPrompt) { setExitPrompt(false); sp?.exitNow?.() }
        setTimeout(() => setSaveMsg(null), 8000)
      } else if (!res?.canceled) {
        // Cancelling the native dialog is not an error; anything else is, and she should
        // see why rather than watch the dialog vanish.
        setExportNote(res?.error || 'Export failed.')
      }
    } finally {
      setExportBusy(false)
    }
  }
  const fileRef = useRef<HTMLInputElement>(null)

  /** Runs fn while ticking a once-per-second elapsed timer for the "thinking" UI. */
  async function withTimer<T>(fn: () => Promise<T>): Promise<T> {
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    try { return await fn() } finally { clearInterval(timer) }
  }

  async function handleFileAttach(file: File) {
    setAttachMsg(null)
    setAttachedData(null)
    setAttachedName(file.name)

    // DeepSeek R1 (deepseek-reasoner) is a text-only reasoning model — no vision input.
    if (file.type.startsWith('image/')) {
      setAttachedName(null)
      setAttachMsg('DeepSeek R1 is text-only and cannot read images. Attach a PDF, DOCX, TXT or MD file, or paste the content into Notes.')
      return
    }

    // Browsers cannot extract text from PDF/DOCX; route those through the Electron
    // helper, which uses pdf-parse / mammoth in the main process.
    if (/\.(pdf|docx)$/i.test(file.name)) {
      const sp = window.seniorPartner
      if (!sp?.pickAndReadFile) {
        setAttachedName(null)
        setAttachMsg('PDF and DOCX attachments need the desktop app. Attach a TXT or MD file, or paste the text into Notes.')
        return
      }
      const result = await sp.pickAndReadFile()
      if (result.canceled) { setAttachedName(null); return }
      if (!result.success || !result.text) {
        setAttachedName(null)
        setAttachMsg(result.error ?? 'Could not read that document.')
        return
      }
      setAttachedName(result.fileName ?? file.name)
      setAttachedData({ type: 'text', text: `[Attached: ${result.fileName ?? file.name}]\n\n${result.text}` })
      return
    }

    const text = await file.text()
    setAttachedData({ type: 'text', text: `[Attached: ${file.name}]\n\n${text}` })
  }

  /* Generate */
  const generate = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error('Add your DeepSeek API key in Settings.')

      const chipList  = chips.length ? `Topics: ${chips.join(', ')}` : ''
      const modeDescs = modes.map((m) => MODES.find((x) => x.value === m)?.label ?? m).join(' + ')
      // Custom mode: use free-form prompt directly; otherwise build structured request
      const prompt = customPrompt.trim()
        ? customPrompt.trim()
        : `Generate a ${modeDescs} for a 1L law student on the following.\n\nSubject: ${subjectLabel}\n${topic ? `Topic: ${topic}\n` : ''}${chipList}\n${notes ? `Notes:\n${notes}` : ''}`

      const userPromptText = attachedData && attachedData.text
        ? `${attachedData.text}\n\n${prompt}`
        : prompt
      setLastUserContent(userPromptText)
      setStreamBuffer('')
      setReasoning('')

      // Streamed so the outline types out live instead of leaving a silent
      // 30-90s spinner; the model's reasoning trace is surfaced in the UI.
      const outcome = await withTimer(() => streamAi({
        messages: [
          { role: 'system', content: BIA_SYSTEM },
          { role: 'user',   content: userPromptText },
        ],
        apiKey,
        // 24,576 (1.5x the old 16,384). At 16,384 R1 produced 37,722 chars and hit the
        // ceiling mid-attribute; the extra headroom covers most whole-subject outlines
        // outright, and the one bounded continuation in the main process covers the
        // rest without pushing the run into timeout territory.
        maxTokens: 24576,
        // The house four-tier stylesheet is a hard requirement. R1 does not honour it
        // on its own, so the main process always runs the format-stable second pass.
        formatStrict: true,
        onContent:   (delta) => setStreamBuffer((prev) => prev + delta),
        onReasoning: (delta) => setReasoning((prev) => prev + delta),
        // The draft was replaced (truncated, or reformatted to the house style) —
        // clear what has been typed so she sees the finished artifact, not a dead draft
        // followed by a second copy of it.
        onStage:     (_stage, reset) => { if (reset) setStreamBuffer('') },
      }))

      if (outcome.error) throw new Error(outcome.error)
      if (!outcome.content.trim()) {
        throw new Error('DeepSeek returned an empty outline. Try again or switch to DeepSeek-V3 in Settings.')
      }
      return outcome.content
    },
    onSuccess: (html) => { setOutput(html); setStreamBuffer('') },
    onError:   () => setStreamBuffer(''),
  })

  /* Continue generating (appends to existing output) */
  const continueGen = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error('Add your DeepSeek API key in Settings.')
      if (!output || !lastUserContent) throw new Error('Nothing to continue.')
      setStreamBuffer('')
      setReasoning('')

      const outcome = await withTimer(() => streamAi({
        messages: [
          { role: 'system',    content: BIA_SYSTEM },
          { role: 'user',      content: lastUserContent },
          { role: 'assistant', content: output },
          { role: 'user',      content: 'Continue the outline from exactly where you stopped. Do not repeat any content already written. Continue seamlessly in the same HTML tier format.' },
        ],
        apiKey,
        maxTokens: 16384,
        onContent:   (delta) => setStreamBuffer((prev) => prev + delta),
        onReasoning: (delta) => setReasoning((prev) => prev + delta),
      }))

      if (outcome.error) throw new Error(outcome.error)
      return outcome.content
    },
    onSuccess: (continuation) => { setOutput((prev) => (prev ?? '') + continuation); setStreamBuffer('') },
    onError:   () => setStreamBuffer(''),
  })

  /* ── Save: local Vault first, cloud second, file export as the standing fallback ── */

  /**
   * Stores the outline somewhere durable.
   *
   * Order matters. The local Vault is written FIRST because it is the step that cannot
   * fail for environmental reasons: no network, no Supabase project, no table, no RLS
   * policy. This used to be one Supabase insert, so a misconfigured or unprovisioned
   * project meant her work was stored nowhere and the UI said only "Save failed".
   */
  async function addToVault() {
    if (!output) return

    const topicLabel = topic || chips[0] || 'Untitled'

    const sp = (window as any).seniorPartner
    const tagList = vaultTags.split(',').map((t) => t.trim()).filter(Boolean)

    // 1. Disk first. This is the step that cannot fail for environmental reasons, so the
    //    artifact is safe before any network call is made.
    const local = await sp?.vaultSave?.({
      topic: topicLabel,
      subject,
      mode:  primaryMode,
      tags:  tagList,
      html:  output,
    })

    if (!local || !local.success) {
      // Nothing durable happened (e.g. no preload bridge). Go straight to the file route
      // rather than reporting a failure and leaving her with nothing.
      setExportNote(local?.error || 'This build cannot write to the Vault folder.')
      setExportOpen(true)
      return
    }

    markSaved()
    setSavedLocally(true)

    // 2. No cloud project in this build. The local copy is the answer, and the file route
    //    is offered immediately because that is what she asked for: a Word or PDF copy of
    //    the exact outline, in a folder she chooses.
    if (!isSupabaseConfigured) {
      setSaveMsg('Saved in the app Vault \u2713')
      setTimeout(() => setSaveMsg(null), 4000)
      setExportOpen(true)
      return
    }

    // 3. Cloud mirror. Best effort by design; the local copy above is already durable.
    const { error } = await supabase.from('documents').insert({
      user_id:      BIANNA_USER_ID,
      subject,
      mode:         primaryMode,
      topic:        topicLabel,
      html_content: output,
      pdf_url:      null,
    } as any)

    if (error) {
      setSaveMsg('Save failed — run the schema SQL in Supabase first')
    } else {
      setSaveMsg('Saved to Document Vault ✓')
    }
    setTimeout(() => setSaveMsg(null), 4000)

    if (error) {
      // The local copy above is already on disk, so a cloud failure is a sync problem, not
      // a lost outline. Correct the message that branch just wrote and offer the file
      // route she asked for instead of leaving a dead end.
      setSaveMsg('Saved in the app Vault \u2713  (cloud sync unavailable)')
      setExportNote(error.message)
      setExportOpen(true)
    }

    // Push outline summary to local long-term memory. `sp` is already in scope above.
    sp?.memoryWrite?.({
      content: `**Subject:** ${subject} | **Mode:** ${primaryMode}\n\n${output.slice(0, 1200)}${output.length > 1200 ? '\n\n…[truncated]' : ''}`,
      type:    'longterm',
      heading: `Outline: ${topicLabel}`,
    })?.catch(() => { /* silent */ })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — controls */}
      <section className="w-[400px] shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-8 space-y-8 overflow-y-auto no-scrollbar">
        <header>
          <p className="font-label uppercase tracking-widest text-[10px] text-primary font-bold mb-2">Drafting Suite</p>
          <h1 className="font-serif text-3xl text-on-surface leading-tight">Outline Generator</h1>
          <p className="text-on-surface-variant text-sm mt-2 italic">AI-assisted structural drafting in Bia style.</p>
        </header>

        {/* Subject — presets through the shared chip group, with inline custom entry */}
        <div className="space-y-3">
          <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Subject</label>
          <EditableChipGroup
            presets={SUBJECTS.map((s) => (s.value === 'other' ? { value: 'other', label: customSubject.trim() || 'Other' } : s))}
            value={subject}
            onChange={(v) => {
              const val = String(v)
              const preset = SUBJECTS.find((s) => s.value === val)
              if (preset) {
                setSubject(preset.value)
                setChips([])
              } else {
                // A typed course name: keep the "Other" chip active and use the text
                // as the subject context, exactly as before.
                setSubject('other')
                setCustomSubject(val)
              }
            }}
            storageKey={EDITABLE_STORAGE_KEYS.outlineSubject}
            columns={2}
            placeholder="e.g. Evidence, Corporations, Federal Courts…"
          />
          {subject === 'other' && customSubject.trim() && (
            <p className="text-[10px] text-on-surface-variant">
              Using <span className="text-primary font-bold">{customSubject}</span> as the subject context.
            </p>
          )}
        </div>

        {/* Mode — multi-select, through the shared chip group */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Mode</label>
            <span className="text-[9px] text-on-surface-variant/60 font-label">Select multiple</span>
          </div>
          <EditableChipGroup
            presets={MODES.map((m) => ({ value: m.value, label: m.label, icon: m.icon, desc: m.desc }))}
            value={modes}
            onChange={(v) => {
              const next = (Array.isArray(v) ? v : [v]) as DocumentMode[]
              // At least one mode must stay selected: the generator has nothing to
              // produce from an empty set.
              setModes(next.length ? next : ['full_outline'])
            }}
            multi
            storageKey={EDITABLE_STORAGE_KEYS.outlineMode}
            columns={2}
          />
        </div>

        {/* Custom free-form request (shown when Custom mode selected OR always visible) */}
        {modes.includes('custom') && (
          <div className="space-y-3">
            <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">
              Custom Request
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
              placeholder="Describe exactly what you need — e.g. 'Compare IRAC and CREAC for a torts negligence issue involving a slip-and-fall with contributory negligence'"
              className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none resize-none transition-all"
            />
            <p className="text-[9px] text-on-surface-variant/60">This overrides subject/topic — use it to generate anything.</p>
          </div>
        )}

        {/* Topic + chips */}
        <div className="space-y-3">
          <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Doctrine, case, or concept…"
            className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all"
          />
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto no-scrollbar">
            {(TOPIC_CHIPS[subject] ?? []).map((chip) => (
              <button
                key={chip}
                onClick={() => setChips((p) => p.includes(chip) ? p.filter((c) => c !== chip) : [...p, chip])}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  chips.includes(chip)
                    ? 'bg-primary text-on-primary'
                    : 'bg-secondary-container text-on-secondary-container hover:bg-primary-container'
                }`}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-3">
          <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Notes / Reading Checklist</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Paste class notes, professor quotes, or a reading checklist…"
            className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none resize-none transition-all"
          />
        </div>

        {/* File attach */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFileAttach(e.target.files[0]) }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center gap-2 py-2.5 px-4 rounded-lg border border-dashed border-outline-variant/40 hover:border-primary/40 text-sm text-on-surface-variant hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-base">attach_file</span>
            {attachedName ?? 'Attach PDF / DOCX / TXT'}
          </button>
          {attachedName && (
            <button
              onClick={() => { setAttachedName(null); setAttachedData(null) }}
              className="mt-1 text-[10px] text-error hover:underline"
            >
              Remove attachment
            </button>
          )}
          {attachMsg && (
            <p className="mt-2 text-[10px] text-error bg-error-container rounded-lg px-3 py-2">{attachMsg}</p>
          )}
        </div>

        {/* Cost + Generate */}
        <div className="pt-4 border-t border-outline-variant/10">
          <div className="flex items-center justify-between p-3 bg-tertiary-fixed/30 rounded-xl mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary text-base">receipt_long</span>
              <span className="text-xs text-on-surface-variant">Estimated cost</span>
            </div>
            <span className="text-sm font-bold text-primary">~$0.02 / outline</span>
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !apiKey}
            className="w-full py-4 bg-primary text-on-primary rounded-full font-label uppercase tracking-widest text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generate.isPending ? 'Generating…' : 'Generate Outline →'}
          </button>
          {!apiKey && (
            <p className="text-[10px] text-on-surface-variant text-center mt-2">Add API key in Settings first.</p>
          )}
        </div>
      </section>

      {/* Right panel — live preview */}
      <section className="flex-1 flex flex-col overflow-hidden bg-surface-container-lowest">
        {/* Toolbar */}
        {output && (
          <div className="flex items-center gap-2 px-6 py-3 border-b border-outline-variant/10 bg-surface-container-low shrink-0">
            <button
              onClick={() => navigator.clipboard.writeText(output)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base">content_copy</span> Copy HTML
            </button>
            <button
              onClick={addToVault}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base">save</span> Add to Vault
            </button>
            <button
              onClick={() => { setExportNote(null); setExportOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base">download</span> Save as Word / PDF
            </button>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || continueGen.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">refresh</span> Regenerate
            </button>
            <button
              onClick={() => continueGen.mutate()}
              disabled={continueGen.isPending || generate.isPending || !lastUserContent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-base">expand_more</span>
              {continueGen.isPending ? 'Continuing (may take 1-2m)…' : 'Continue'}
            </button>
            {saveMsg && (
              <span className={`text-xs ml-auto font-medium ${saveMsg.includes('failed') ? 'text-error' : 'text-primary'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        )}

        {/* Preview area */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Live "thinking" panel: elapsed time + the model's reasoning trace.
              A 30-90s silent wait reads as a crash, so R1's chain-of-thought is
              streamed in and can be watched as it works. */}
          {(generate.isPending || continueGen.isPending) && (
            <div className="max-w-3xl mx-auto mb-6">
              <div className="flex items-center gap-3 text-on-surface-variant">
                <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-xs font-label uppercase tracking-widest">
                  DeepSeek R1 is reasoning… {elapsed}s
                </p>
              </div>
              {reasoning && (
                <details className="mt-3 rounded-xl border border-outline-variant/20 bg-surface-container-low" open>
                  <summary className="cursor-pointer select-none px-4 py-2 text-[10px] font-label font-bold uppercase tracking-widest text-on-surface-variant">
                    DeepSeek&apos;s Legal Reasoning Trace
                  </summary>
                  <pre className="px-4 pb-4 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-on-surface-variant font-mono">
                    {reasoning}
                  </pre>
                </details>
              )}
            </div>
          )}

          {(generate.error || continueGen.error) && (
            <div className="bg-error-container text-on-error-container rounded-xl p-6 max-w-lg mx-auto mt-12">
              <p className="font-semibold mb-1">Generation failed</p>
              <p className="text-sm">{((generate.error || continueGen.error) as Error).message}</p>
            </div>
          )}

          {/* Streamed tokens render as they arrive, so the outline builds live. */}
          {(generate.isPending || continueGen.isPending) && streamBuffer && (
            <div
              className="bia-outline max-w-3xl mx-auto opacity-90"
              dangerouslySetInnerHTML={{ __html: streamBuffer }}
            />
          )}

          {output && !generate.isPending && !continueGen.isPending && (
            <div
              className="bia-outline max-w-3xl mx-auto"
              dangerouslySetInnerHTML={{ __html: output }}
            />
          )}

          {output && reasoning && !generate.isPending && !continueGen.isPending && (
            <details className="max-w-3xl mx-auto mt-8 rounded-xl border border-outline-variant/20 bg-surface-container-low">
              <summary className="cursor-pointer select-none px-4 py-3 text-[10px] font-label font-bold uppercase tracking-widest text-on-surface-variant">
                DeepSeek&apos;s Legal Reasoning Trace
              </summary>
              <pre className="px-4 pb-4 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-on-surface-variant font-mono">
                {reasoning}
              </pre>
            </details>
          )}

          {!output && !generate.isPending && !continueGen.isPending && !generate.error && (
            <div className="flex flex-col items-center gap-4 mt-24 text-on-surface-variant">
              <span className="material-symbols-outlined text-5xl text-outline-variant">architecture</span>
              <p className="font-serif text-xl text-on-surface-variant">Select a subject and topic to generate</p>
              <p className="text-sm text-center max-w-sm">
                Your Bia-style outline will render here — four-tier structure with sage headers, bordered callouts, and bold case citations.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Save fallback ───────────────────────────────────────────────────────
          Reached in two situations: the cloud Vault cannot take the outline, or the app
          was asked to close with work still unsaved. The exact rendered outline is
          written out -- never a summary and never a re-generation -- first as a Word or
          PDF file for a folder she chooses, or alternatively into the in-app Vault where
          it can be tagged and organised alongside everything else. */}
      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-lg rounded-2xl bg-surface-container-low shadow-2xl border border-outline-variant/20">
            <div className="px-6 py-5 border-b border-outline-variant/10">
              <h2 className="font-serif text-xl text-on-surface">
                {exitPrompt ? 'Save this outline before closing?' : 'Save your outline'}
              </h2>
              <p className="text-xs text-on-surface-variant mt-1">
                {exportNote ?? 'Choose a file format, then where it should go.'}
              </p>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Format</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['docx', 'Word', 'description'], ['pdf', 'PDF', 'picture_as_pdf'], ['html', 'Web page', 'language']] as const).map(([value, label, icon]) => (
                    <button
                      key={value}
                      onClick={() => setExportFormat(value)}
                      className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-label transition-colors ${exportFormat === value ? 'border-primary text-primary bg-primary/5' : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/60'}`}
                    >
                      <span className="material-symbols-outlined text-lg">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1.5">Tags for the Vault (optional)</label>
                <input
                  value={vaultTags}
                  onChange={(e) => setVaultTags(e.target.value)}
                  placeholder="e.g. Final, Professor Hook, Torts"
                  className="w-full bg-surface-container-low rounded-lg px-3 py-2 text-sm outline-none border border-outline-variant/20 focus:border-primary transition-colors"
                />
                {savedLocally && (
                  <p className="text-[10px] text-primary mt-1.5">
                    Already kept in the app Vault &#8212; tags are applied when you save again.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end px-6 py-4 border-t border-outline-variant/10">
              {exitPrompt && (
                <button
                  onClick={() => { setExitPrompt(false); (window as any).seniorPartner?.exitNow?.() }}
                  className="px-4 py-2 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors mr-auto"
                >
                  Discard and close
                </button>
              )}
              <button
                onClick={() => { setExportOpen(false); setExitPrompt(false) }}
                className="px-4 py-2 rounded-full text-xs font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={exportBusy}
                onClick={() => exportOutline('vault')}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full border border-primary/40 text-primary text-xs font-bold hover:bg-primary/5 transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">inventory_2</span>
                Keep in app Vault
              </button>
              <button
                disabled={exportBusy}
                onClick={() => exportOutline('folder')}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">{exportBusy ? 'hourglass_empty' : 'folder_open'}</span>
                {exportBusy ? 'Saving…' : 'Save to a folder…'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

