import { useMemo, useRef, useState } from 'react'

/**
 * Simplify — "Simplify Legal by Eagle".
 *
 * Ported from AHB102/Legal_Eagle, whose premise is that the barrier to a legal document is
 * rarely the law and almost always the prose. Eagle does three things: it restates the
 * document in plain language, it translates the restatement, and it reads it aloud. All three
 * exist here, because the third is what makes the first two usable by someone who is not going
 * to read a screen.
 *
 * What changed in the port, and why:
 *
 *  - Summarisation runs through this app's existing model bridge (`aiPromptSend`) rather than
 *    a Cerebras endpoint. The app ships with no Cerebras key and must boot offline, and a
 *    feature that cannot run without a vendor that is not configured is a screenshot, not a
 *    feature. The prompt contract below is the part worth keeping, and it is strict about the
 *    one thing that matters legally: the summary may compress and may simplify, but it may not
 *    add an obligation the document does not contain.
 *
 *  - Audio uses the operating system's speech engine (`speechSynthesis`) instead of a hosted
 *    TTS call. It works with no network, no key and no per-word cost, which is what makes
 *    "listen to this" a thing you can offer on every document rather than a paid extra.
 *
 *  - The document never leaves the machine for the audio step, and the plain-language step
 *    sends only the text the user pasted or dropped.
 */

const LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'es-ES', label: 'Español' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ar-SA', label: 'العربية' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'ru-RU', label: 'Русский' },
  { code: 'vi-VN', label: 'Tiếng Việt' },
]

/**
 * The prompt contract. Deliberately enumerated rather than "summarise this", because a general
 * instruction produces a general summary and this feature's whole claim is specificity.
 * The closing rule — say what the document does not cover — is the one that keeps a
 * plain-language restatement from reading as advice.
 */
const SYSTEM = `You restate legal documents in plain language for a reader with no legal training.

Absolute rules:
- Never add an obligation, deadline, right or amount that is not in the text. If something is
  ambiguous, say it is ambiguous. If something is missing, say it is missing.
- Do not give legal advice and do not tell the reader what they should do. Describe the
  document only.
- Keep defined terms when the definition matters, but gloss them on first use.
- Target an eighth-grade reading level: short sentences, active voice, no Latin.

Return plain text, exactly these sections, no markdown fences:

WHAT THIS DOCUMENT IS
One short paragraph.

THE FIVE THINGS THAT MATTER
Numbered list, at most five items. Omit rather than pad.

WHAT YOU HAVE TO DO
Bullets with any deadline or date stated in the document. If there are none, write "None stated."

DATES AND AMOUNTS
One line per figure. If there are none, write "None stated."

WORDS THAT MEAN SOMETHING SPECIFIC
Term — plain meaning. Only terms actually defined in the document.

WHAT THIS DOCUMENT DOES NOT COVER
One or two bullets on the gaps a reader would otherwise assume are handled.`

interface Section {
  heading: string
  body: string
}

/** Split the model's reply on the section headings the prompt requires. */
function parseSections(text: string): Section[] {
  const headings = [
    'WHAT THIS DOCUMENT IS',
    'THE FIVE THINGS THAT MATTER',
    'WHAT YOU HAVE TO DO',
    'DATES AND AMOUNTS',
    'WORDS THAT MEAN SOMETHING SPECIFIC',
    'WHAT THIS DOCUMENT DOES NOT COVER',
  ]

  const sections: Section[] = []
  for (let i = 0; i < headings.length; i += 1) {
    const start = text.indexOf(headings[i])
    if (start < 0) continue
    const bodyStart = start + headings[i].length
    const rest = text.slice(bodyStart)
    const nextIndex = headings
      .slice(i + 1)
      .map((h) => rest.indexOf(h))
      .filter((n) => n >= 0)
    const end = nextIndex.length ? Math.min(...nextIndex) : rest.length
    const body = rest.slice(0, end).trim()
    if (body) sections.push({ heading: headings[i], body })
  }

  // A reply that ignored the contract is still shown, verbatim, rather than dropped: an
  // unformatted summary the reader can judge beats an empty panel that implies it failed.
  return sections.length ? sections : [{ heading: 'Summary', body: text.trim() }]
}

export function Simplify() {
  const [source, setSource] = useState('')
  const [summary, setSummary] = useState('')
  const [language, setLanguage] = useState('en-US')
  const [busy, setBusy] = useState<'simplify' | 'translate' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const stats = useMemo(() => {
    const words = source.trim() ? source.trim().split(/\s+/).length : 0
    return {
      words,
      minutes: Math.max(1, Math.round(words / 220)),
    }
  }, [source])

  const sections = useMemo(() => (summary ? parseSections(summary) : []), [summary])

  async function run(kind: 'simplify' | 'translate') {
    const text = source.trim()
    if (!text) {
      setError('Paste a document, or drop a text file in, first.')
      return
    }

    const bridge = window.seniorPartner as unknown as
      | {
          aiPromptSend?: (args: {
            prompt: string
            systemPrompt?: string
            mode?: string
          }) => Promise<{ success?: boolean; response?: string; error?: string }>
        }
      | undefined

    if (!bridge?.aiPromptSend) {
      setError(
        'The model bridge is unavailable outside the desktop app. Paste a summary in the panel ' +
          'on the right to use the reader and the audio.',
      )
      return
    }

    setBusy(kind)
    setError(null)

    try {
      const prompt =
        kind === 'simplify'
          ? `RESTATE THIS DOCUMENT.\n\n---\n${text.slice(0, 60000)}\n---`
          : `TRANSLATE the summary below into ${LANGS.find((l) => l.code === language)?.label ?? 'English'}. ` +
            `Preserve the section headings exactly as they are, in English, and translate only ` +
            `the body text. Keep numbers and dates unchanged.\n\n---\n${summary}\n---`

      const res = await bridge.aiPromptSend({
        prompt,
        systemPrompt: kind === 'simplify' ? SYSTEM : undefined,
        mode: 'chat',
      })

      if (!res?.success) {
        setError(res?.error ?? 'The model did not return a summary.')
        return
      }

      const reply = (res.response ?? '').trim()
      if (!reply) {
        setError('The model returned an empty reply.')
        return
      }

      setSummary(reply)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed.')
    } finally {
      setBusy(null)
    }
  }

  function speak() {
    try {
      const synth = window.speechSynthesis
      if (!synth) {
        setError('This build has no speech engine available.')
        return
      }
      if (speaking) {
        synth.cancel()
        setSpeaking(false)
        return
      }
      const utterance = new SpeechSynthesisUtterance(summary)
      utterance.lang = language
      utterance.rate = 0.95
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      synth.cancel()
      synth.speak(utterance)
      setSpeaking(true)
    } catch {
      setError('The speech engine refused the request.')
    }
  }

  async function readFile(file: File) {
    try {
      const text = await file.text()
      setSource(text.slice(0, 120000))
      setSummary('')
      setError(null)
    } catch {
      setError('That file could not be read as text.')
    }
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="border-b border-outline-variant pb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="label-micro">Simplify Legal by Eagle</p>
          <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
            Read it in plain language, then hear it
          </h1>
          <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
            A restatement, a translation, and an audio version of the same document. Based on
            Legal Eagle, which set out to remove both the language barrier and the jargon
            barrier at once.
          </p>
        </div>
        <a
          href="https://github.com/AHB102/Legal_Eagle"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 citation border border-outline-variant px-3 py-2 hover:border-primary/40 transition-colors"
        >
          AHB102/Legal_Eagle ↗
        </a>
      </header>

      {error && (
        <p className="text-sm text-error border-l-2 border-error pl-3 leading-snug">{error}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* ── Source ─────────────────────────────────────────────────────── */}
        <section className="space-y-4 min-w-0">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">The document</h2>
            <p className="label-micro">
              {stats.words} words · ~{stats.minutes} min
            </p>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) void readFile(file)
            }}
            className="border border-dashed border-outline-variant bg-surface"
          >
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={14}
              placeholder="Paste a lease, a notice, a contract clause, or drop a .txt file here…"
              className="w-full bg-transparent px-5 py-4 text-sm outline-none resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2 px-4 py-3 border-t border-outline-variant">
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.md,.csv,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void readFile(file)
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 hover:text-on-surface transition-colors"
              >
                Open a file
              </button>
              <button
                type="button"
                onClick={() => {
                  setSource('')
                  setSummary('')
                  setError(null)
                }}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => void run('simplify')}
                disabled={busy !== null || !source.trim()}
                className="ml-auto px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {busy === 'simplify' ? 'Simplifying…' : 'Simplify →'}
              </button>
            </div>
          </div>

          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            The restatement may shorten and simplify; it may not invent an obligation. Anything
            ambiguous is reported as ambiguous, and anything absent is reported as absent.
          </p>
        </section>

        {/* ── Restatement ────────────────────────────────────────────────── */}
        <section className="space-y-4 min-w-0">
          <div className="flex items-end justify-between border-b border-outline-variant pb-2">
            <h2 className="font-serif text-2xl text-on-surface">In plain language</h2>
            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Language for translation and audio"
                className="bg-surface-container-low rounded-lg px-3 py-1.5 text-xs outline-none border border-outline-variant/20 focus:border-primary transition-colors"
              >
                {LANGS.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={speak}
                disabled={!summary}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                  speaking
                    ? 'bg-accent text-on-accent border-accent'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary/40 disabled:opacity-40'
                }`}
              >
                {speaking ? 'Stop' : 'Listen'}
              </button>
            </div>
          </div>

          <div className="border border-outline-variant bg-surface min-h-[380px]">
            {busy === 'simplify' && (
              <div className="flex flex-col items-center gap-3 py-20 text-on-surface-variant">
                <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="label-micro">Restating</p>
              </div>
            )}

            {busy !== 'simplify' && sections.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-on-surface-variant px-8 text-center">
                <span className="material-symbols-outlined text-5xl text-outline-variant">
                  translate
                </span>
                <p className="font-serif text-xl">Nothing restated yet</p>
                <p className="text-sm max-w-sm leading-relaxed">
                  Paste a document and simplify it, or paste an existing summary into this panel
                  via the translate step.
                </p>
              </div>
            )}

            {busy !== 'simplify' && sections.length > 0 && (
              <div className="divide-y divide-outline-variant">
                {sections.map((section) => (
                  <div key={section.heading} className="px-5 py-4">
                    <p className="label-micro">{section.heading}</p>
                    <p className="text-sm text-on-surface leading-relaxed mt-2 whitespace-pre-wrap">
                      {section.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summary && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void run('translate')}
                disabled={busy !== null}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 hover:text-on-surface transition-colors disabled:opacity-40"
              >
                {busy === 'translate' ? 'Translating…' : 'Translate summary'}
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(summary)}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 hover:text-on-surface transition-colors"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([summary], { type: 'text/plain;charset=utf-8' })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'plain-language-summary.txt'
                  link.click()
                  URL.revokeObjectURL(url)
                }}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 hover:text-on-surface transition-colors"
              >
                Download
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── Provenance ───────────────────────────────────────────────────── */}
      <section className="bg-surface-container-low border border-outline-variant p-6 space-y-2">
        <p className="label-micro">About this port</p>
        <p className="text-[13px] text-on-surface-variant leading-relaxed max-w-3xl">
          Legal Eagle was built on Cerebras-enabled Llama with a custom LangChain chain, chosen
          for the latency a courtroom setting demands. This build keeps the three-part shape —
          restate, translate, read aloud — and routes the restatement through the app&apos;s own
          model bridge, so it needs no second vendor account. Audio uses the operating
          system&apos;s speech engine and never sends the document anywhere.
        </p>
      </section>
    </div>
  )
}
