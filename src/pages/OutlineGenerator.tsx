import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'
import type { DocumentSubject, DocumentMode } from '../types/database'

/* ─── Constants ──────────────────────────────────────────────────────────── */
const SUBJECTS: { value: DocumentSubject; label: string }[] = [
  { value: 'contracts',      label: 'Contracts'   },
  { value: 'torts',          label: 'Torts'        },
  { value: 'civ_pro',        label: 'Civ Pro'      },
  { value: 'constitutional', label: 'Con Law'      },
  { value: 'property',       label: 'Property'     },
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
  const [mobileTab, setMobileTab] = useState<'configure' | 'output'>('configure')

  const [subject,      setSubject]      = useState<DocumentSubject>('contracts')
  const [modes,        setModes]        = useState<DocumentMode[]>(['full_outline'])
  const [topic,        setTopic]        = useState('')
  const [chips,        setChips]        = useState<string[]>([])
  const [customPrompt, setCustomPrompt] = useState('')   // free-form override

  // Single-mode accessor for Supabase save (primary mode)
  const primaryMode = modes[0] ?? 'full_outline'

  function toggleMode(m: DocumentMode) {
    setModes((prev) =>
      prev.includes(m)
        ? prev.length > 1 ? prev.filter((x) => x !== m) : prev   // keep at least one
        : [...prev, m]
    )
  }
  const [notes,        setNotes]        = useState(() => {
    const captured = sessionStorage.getItem('capture_notes')
    if (captured) { sessionStorage.removeItem('capture_notes'); return captured }
    return ''
  })
  const [attachedName,    setAttachedName]    = useState<string | null>(null)
  const [attachedData,    setAttachedData]    = useState<{ type: string; [k: string]: unknown } | null>(null)
  const [attachLoading,   setAttachLoading]   = useState(false)
  const [output,          setOutput]          = useState<string | null>(null)
  const [saveMsg,         setSaveMsg]         = useState<string | null>(null)
  const [lastUserContent, setLastUserContent] = useState<unknown[] | null>(null)

  // Use Electron IPC to pick + decode file (handles PDF via pdf-parse, DOCX via mammoth, images as base64)
  async function handleFileAttach() {
    const sp = (window as any).seniorPartner
    setAttachLoading(true)
    try {
      const result = await sp?.pickAndReadFile?.()
      if (!result || result.canceled) return
      if (!result.success) return
      if (result.isImage) {
        // Image: send as vision content block
        setAttachedData({ type: 'image', source: { type: 'base64', media_type: result.mediaType, data: result.base64 } })
      } else {
        // Text/PDF/DOCX: extracted text already by main.js
        setAttachedData({ type: 'text', text: `[Attached: ${result.fileName}]\n\n${result.text}` })
      }
      setAttachedName(result.fileName)
    } finally {
      setAttachLoading(false)
    }
  }

  /* Generate */
  const generate = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error('Add your Anthropic API key in Settings.')

      const chipList  = chips.length ? `Topics: ${chips.join(', ')}` : ''
      const modeDescs = modes.map((m) => MODES.find((x) => x.value === m)?.label ?? m).join(' + ')
      // Custom mode: use free-form prompt directly; otherwise build structured request
      const prompt = customPrompt.trim()
        ? customPrompt.trim()
        : `Generate a ${modeDescs} for a 1L law student on the following.\n\nSubject: ${subject}\n${topic ? `Topic: ${topic}\n` : ''}${chipList}\n${notes ? `Notes:\n${notes}` : ''}`

      const userContent: unknown[] = [{ type: 'text', text: prompt }]
      if (attachedData) userContent.unshift(attachedData)
      setLastUserContent(userContent)

      let res: Response
      try {
        res = await fetch(CLAUDE_URL, {
          method: 'POST',
          headers: claudeHeaders(apiKey),
          body: JSON.stringify({
            model:      'claude-sonnet-4-6',
            max_tokens: 8192,
            system:     BIA_SYSTEM,
            messages:   [{ role: 'user', content: userContent }],
          }),
        })
      } catch {
        throw new Error('Network error — could not reach Anthropic API. If using Brave, disable Shields for this page (lion icon → toggle off). Otherwise check your internet connection.')
      }

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? `API error ${res.status}`)
      }

      const data = await res.json()
      const text  = data.content?.[0]?.text
      if (!text) throw new Error('Empty response from API — verify your API key in Settings.')
      return text as string
    },
    onSuccess: (html) => { setOutput(html); setMobileTab('output') },
  })

  /* Continue generating (appends to existing output) */
  const continueGen = useMutation({
    mutationFn: async () => {
      if (!apiKey) throw new Error('Add your Anthropic API key in Settings.')
      if (!output || !lastUserContent) throw new Error('Nothing to continue.')

      let res: Response
      try {
        res = await fetch(CLAUDE_URL, {
          method: 'POST',
          headers: claudeHeaders(apiKey),
          body: JSON.stringify({
            model:      'claude-sonnet-4-6',
            max_tokens: 8192,
            system:     BIA_SYSTEM,
            messages: [
              { role: 'user',      content: lastUserContent },
              { role: 'assistant', content: output },
              { role: 'user',      content: 'Continue the outline from exactly where you stopped. Do not repeat any content already written. Continue seamlessly in the same HTML tier format.' },
            ],
          }),
        })
      } catch {
        throw new Error('Network error — could not reach Anthropic API. Disable browser shields for this page and try again.')
      }
      if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message ?? `API error ${res.status}`) }
      const data = await res.json()
      return (data.content?.[0]?.text ?? '') as string
    },
    onSuccess: (continuation) => setOutput((prev) => (prev ?? '') + continuation),
  })

  /* Save to Vault */
  async function saveToVault() {
    if (!output) return

    const topicLabel = topic || chips[0] || 'Untitled'
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

    // Push outline summary to OpenClaw long-term memory
    const sp = (window as any).seniorPartner
    sp?.openClawMemoryWrite?.({
      content: `**Subject:** ${subject} | **Mode:** ${primaryMode}\n\n${output.slice(0, 1200)}${output.length > 1200 ? '\n\n…[truncated]' : ''}`,
      type:    'longterm',
      heading: `Outline: ${topicLabel}`,
    })?.catch(() => { /* silent */ })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mobile tab bar */}
      <div className="lg:hidden flex border-b border-outline-variant/20 bg-surface-container-low shrink-0">
        <button
          onClick={() => setMobileTab('configure')}
          className={`flex-1 py-2.5 text-xs font-label uppercase tracking-widest transition-colors ${mobileTab === 'configure' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant'}`}
        >
          Configure
        </button>
        <button
          onClick={() => setMobileTab('output')}
          className={`flex-1 py-2.5 text-xs font-label uppercase tracking-widest transition-colors ${mobileTab === 'output' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant'}`}
        >
          Output {generate.isPending && '…'}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
      {/* Left panel — controls */}
      <section className={`w-full lg:w-[400px] shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-6 lg:p-8 space-y-8 overflow-y-auto no-scrollbar ${mobileTab === 'output' ? 'hidden lg:flex lg:flex-col' : 'flex flex-col'}`}>
        <header>
          <p className="font-label uppercase tracking-widest text-[10px] text-primary font-bold mb-2">Drafting Suite</p>
          <h1 className="font-serif text-3xl text-on-surface leading-tight">Outline Generator</h1>
          <p className="text-on-surface-variant text-sm mt-2 italic">AI-assisted structural drafting in Bia style.</p>
        </header>

        {/* Subject */}
        <div className="space-y-3">
          <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Subject</label>
          <div className="grid grid-cols-2 gap-2">
            {SUBJECTS.map((s) => (
              <button
                key={s.value}
                onClick={() => { setSubject(s.value); setChips([]) }}
                className={`px-3 py-2 rounded-lg text-xs font-bold text-center transition-colors ${
                  subject === s.value
                    ? 'bg-surface-container-lowest border border-primary text-primary'
                    : 'bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mode — multi-select */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="font-label uppercase tracking-widest text-[10px] text-on-surface-variant font-bold">Mode</label>
            <span className="text-[9px] text-on-surface-variant/60 font-label">Select multiple</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {MODES.map((m) => {
              const active = modes.includes(m.value)
              return (
                <button
                  key={m.value}
                  onClick={() => toggleMode(m.value)}
                  className={`p-3 rounded-xl text-left space-y-1.5 transition-all relative ${
                    active
                      ? 'bg-primary text-on-primary shadow-lg'
                      : 'bg-surface-container-lowest border border-outline-variant/20 hover:bg-surface-container-high'
                  }`}
                >
                  {active && (
                    <span className="absolute top-1.5 right-1.5 material-symbols-outlined text-[12px] opacity-70">check</span>
                  )}
                  <span className={`material-symbols-outlined text-lg ${active ? '' : 'text-primary'}`}>{m.icon}</span>
                  <p className="text-[10px] font-bold font-label uppercase tracking-wider">{m.label}</p>
                  <p className={`text-[9px] leading-snug ${active ? 'opacity-80' : 'text-on-surface-variant'}`}>{m.desc}</p>
                </button>
              )
            })}
          </div>
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
          <button
            onClick={handleFileAttach}
            disabled={attachLoading}
            className="w-full flex items-center gap-2 py-2.5 px-4 rounded-lg border border-dashed border-outline-variant/40 hover:border-primary/40 text-sm text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">
              {attachLoading ? 'hourglass_empty' : 'attach_file'}
            </span>
            {attachLoading ? 'Reading file…' : (attachedName ?? 'Attach PDF / Image / DOCX')}
          </button>
          {attachedName && (
            <button
              onClick={() => { setAttachedName(null); setAttachedData(null) }}
              className="mt-1 text-[10px] text-error hover:underline"
            >
              Remove attachment
            </button>
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
      <section className={`flex-1 flex flex-col overflow-hidden bg-surface-container-lowest ${mobileTab === 'configure' ? 'hidden lg:flex' : 'flex'}`}>
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
              onClick={saveToVault}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-label text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-base">save</span> Add to Vault
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
          {generate.isPending && (
            <div className="flex flex-col items-center gap-4 mt-24 text-on-surface-variant">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <p className="text-sm font-label uppercase tracking-widest">Drafting outline…</p>
            </div>
          )}
          {(generate.error || continueGen.error) && (
            <div className="bg-error-container text-on-error-container rounded-xl p-6 max-w-lg mx-auto mt-12">
              <p className="font-semibold mb-1">Generation failed</p>
              <p className="text-sm">{((generate.error || continueGen.error) as Error).message}</p>
            </div>
          )}
          {output && !generate.isPending && (
            <div
              className="bia-outline max-w-3xl mx-auto"
              dangerouslySetInnerHTML={{ __html: output }}
            />
          )}
          {!output && !generate.isPending && !generate.error && (
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
      </div>
    </div>
  )
}

