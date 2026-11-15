import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advocateText,
  chooseStrategy,
  ontologyFor,
  readOpening,
  movesFor,
  validateArgumentLibrary,
} from '../lib/argumentEngine'
import type { ArgumentState, DomainId, Exchange, StrategyChoice } from '../lib/argumentEngine'
import { BENCH, attorneyFor } from '../lib/attorneys'
import type { LegalAttorney } from '../lib/attorneys'

/**
 * OralArgument — a live argument against a domain-dedicated attorney.
 *
 * Two things make this different from a chat window, and both are visible on screen.
 *
 * 1. THE ATTORNEY IS BOUND TO ONE DOMAIN. Selecting Property gives Makdisi, who will not argue
 *    contracts; asked outside his ground he names Fisher and declines. The refusal is data, not a
 *    hope — see `attorneys.ts`.
 *
 * 2. THE STRATEGY IS CHOSEN BY THE ENGINE, NOT THE MODEL. Every turn the advocate speaks is read
 *    for the premises it commits to, the move library is re-scored against that read, and the
 *    attorney's turn is generated *from the chosen move*. When the read changes the ranking the
 *    attorney switches, and the panel says which move was abandoned and which opposing premise did
 *    it. That is the whole reason to keep a possibility graph rather than one long prompt.
 *
 * Voice: the browser's speech engine by default (works offline, no key). A local RealtimeVoiceChat
 * server is detected if running and reported; the argument does not depend on it.
 */

interface SpeechResultAlternative { transcript: string }
interface SpeechResultList {
  length: number
  [index: number]: { 0: SpeechResultAlternative; length: number }
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: SpeechResultList }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const DOMAIN_CHOICES: Array<{ id: DomainId; label: string }> = [
  { id: 'property', label: 'Property' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'constitutional', label: 'Constitutional' },
  { id: 'torts', label: 'Torts' },
]

function speechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function OralArgument() {
  const [domain, setDomain] = useState<DomainId>('property')
  const [state, setState] = useState<ArgumentState | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [choice, setChoice] = useState<StrategyChoice | null>(null)
  const [voiceServer, setVoiceServer] = useState<'unknown' | 'up' | 'down'>('unknown')
  const [scope, setScope] = useState<{ chunks: number; sources: number } | null>(null)
  const [grounded, setGrounded] = useState<Array<{ source: string; title: string }>>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceName, setVoiceName] = useState<string>('')
  const [rate, setRate] = useState<number>(1.15)
  const [pitch, setPitch] = useState<number>(1)

  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  const attorney: LegalAttorney = useMemo(() => attorneyFor(domain), [domain])
  const ontology = useMemo(() => ontologyFor(domain), [domain])
  const moves = useMemo(() => movesFor(domain), [domain])

  // A move that names a weakness the reader cannot detect will never adapt. Report it rather than
  // letting the attorney appear stubborn for no visible reason.
  useEffect(() => {
    const orphans = validateArgumentLibrary()
    if (orphans.length) console.warn('[argument] unreachable move weaknesses:', orphans)
  }, [])

  // What this attorney can actually reach. Shown, not assumed: a dedicated profile is only
  // dedicated if the corpus behind it is partitioned, so the size of the slice is on screen.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const stats = await window.seniorPartner?.ragStats?.()
        if (cancelled || !stats?.success) return
        setScope({
          chunks: stats.domains?.[attorney.domain] ?? 0,
          sources: stats.domainSourceCounts?.[attorney.domain] ?? 0,
        })
      } catch {
        if (!cancelled) setScope(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attorney.domain])

  // Probe the optional local voice server once. Failure is the normal case and is not an error.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    void fetch('http://127.0.0.1:8000/', { signal: controller.signal })
      .then(() => {
        if (!cancelled) setVoiceServer('up')
      })
      .catch(() => {
        if (!cancelled) setVoiceServer('down')
      })
      .finally(() => clearTimeout(timer))
    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [state?.exchanges.length])

  const speechRecognitionAvailable = useMemo(() => speechRecognition() !== null, [])

  /**
   * Voices are populated asynchronously by the OS, and `getVoices()` frequently returns an empty
   * array on first call — so the list is read now and again on `voiceschanged`. A picker that
   * renders empty and never fills is the usual reason this control is unusable in Electron.
   */
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return

    const load = () => {
      /**
       * Sorted by likely quality, not alphabetically. The stock Windows voice is "Microsoft David",
       * which is the flat monotone the user hears first; the Natural/Online voices are markedly
       * better and should be the default whenever the machine has them.
       */
      const quality = (voice: SpeechSynthesisVoice) => {
        const name = voice.name.toLowerCase()
        if (/natural|neural/.test(name)) return 0
        if (/online/.test(name)) return 1
        if (/aria|jenny|guy|sonia|ryan|zira|libby|michelle/.test(name)) return 2
        return 3
      }
      const all = synth
        .getVoices()
        .filter((voice) => voice.lang.toLowerCase().startsWith('en'))
        .sort((a, b) => quality(a) - quality(b) || a.name.localeCompare(b.name))

      setVoices(all)
      setVoiceName((current) => {
        if (current && all.some((voice) => voice.name === current)) return current
        const stored = (() => {
          try {
            return localStorage.getItem('slp_argument_voice')
          } catch {
            return null
          }
        })()
        if (stored && all.some((voice) => voice.name === stored)) return stored
        return all[0] ? all[0].name : ''
      })
    }

    load()
    synth.addEventListener('voiceschanged', load)
    return () => synth.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('slp_argument_voice', voiceName)
    } catch {
      /* persistence is a convenience; the control still works for this session */
    }
  }, [voiceName])

  const speak = useCallback(
    (text: string) => {
      try {
        const synth = window.speechSynthesis
        if (!synth || !text.trim()) return
        synth.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        // A rate near 1 is what makes this listenable; the old 0.86 read as a slowed-down machine.
        utterance.rate = Math.min(2, Math.max(0.5, rate))
        utterance.pitch = Math.min(2, Math.max(0.5, pitch))
        const chosen = voices.find((voice) => voice.name === voiceName)
        if (chosen) utterance.voice = chosen
        utterance.onend = () => setSpeaking(false)
        utterance.onerror = () => setSpeaking(false)
        synth.speak(utterance)
        setSpeaking(true)
      } catch {
        setSpeaking(false)
      }
    },
    [rate, pitch, voices, voiceName],
  )

  const toggleListening = useCallback(() => {
    const Recognition = speechRecognition()
    if (!Recognition) {
      setNotice('This build has no speech recognition; type the argument instead.')
      return
    }
    if (listening) {
      recognition.current?.stop()
      setListening(false)
      return
    }
    const instance = new Recognition()
    instance.lang = 'en-US'
    instance.interimResults = false
    instance.continuous = false
    instance.onresult = (event) => {
      let heard = ''
      for (let i = 0; i < event.results.length; i += 1) {
        const alternative = event.results[i][0]
        if (alternative) heard += `${alternative.transcript} `
      }
      if (heard.trim()) setInput((prev) => `${prev} ${heard.trim()}`.trim())
    }
    instance.onerror = () => {
      setListening(false)
      setNotice('The microphone was refused or unavailable.')
    }
    instance.onend = () => setListening(false)
    recognition.current = instance
    try {
      instance.start()
      setListening(true)
      setNotice(null)
    } catch {
      setNotice('The microphone could not be started.')
    }
  }, [listening])

  /** Ask the model to phrase the chosen strategy, grounded only in this attorney's slice. */
  const phraseTurn = useCallback(
    async (
      move: { claim: string; authority: string; kind: string },
      reason: string,
      read: { premises: string[] },
      opponent: string,
      round: number,
      grounding: string,
    ): Promise<string> => {
      const fallback = `${move.claim} That is ${move.authority}.`
      const bridge = (window as unknown as {
        seniorPartner?: {
          aiPromptSend?: (args: { prompt: string; systemPrompt?: string; mode?: string }) => Promise<{
            success?: boolean
            response?: string
          }>
        }
      }).seniorPartner
      if (!bridge?.aiPromptSend) return fallback

      const prompt = [
        `ROUND ${round}. Speak your turn.`,
        `STRATEGY YOU MUST ARGUE: ${move.kind} — ${move.claim}`,
        `AUTHORITY: ${move.authority}`,
        `WHY THIS STRATEGY WAS CHOSEN: ${reason}`,
        read.premises.length ? `WHAT YOU READ IN THEIR ARGUMENT: ${read.premises.join('; ')}` : '',
        grounding
          ? `PASSAGES FROM YOUR ${attorney.domain.toUpperCase()} LIBRARY — the only sources you may cite:\n\n${grounding}`
          : `NO LIBRARY PASSAGE MATCHED. Argue the rule from ${attorney.domain} doctrine and say the citation must be checked.`,
        `THEY SAID: ${opponent.slice(-1800)}`,
        'Reply with two to four spoken sentences. No headings, no lists.',
      ]
        .filter(Boolean)
        .join('\n\n')

      try {
        // Bounded: a model call that never settles must not leave the turn in "reading it…"
        // forever, because the strategy is already chosen and only the phrasing is pending. The
        // fallback sentence uses the same move, so the argument continues either way.
        const result = await Promise.race([
          bridge.aiPromptSend({
            prompt,
            systemPrompt: attorney.systemPrompt,
            mode: 'chat',
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
        ])
        return result?.success && result.response?.trim() ? result.response.trim() : fallback
      } catch {
        return fallback
      }
    },
    [attorney],
  )

  async function submit() {
    const text = input.trim()
    if (!text || !state || busy) return
    setBusy(true)
    setNotice(null)

    const advocateExchange: Exchange = {
      id: crypto.randomUUID(),
      speaker: 'advocate',
      text,
    }

    // Read the *whole* advocate side, not just this turn: a later answer can commit to a premise
    // the opening only implied, and the attorney should react to that.
    const withAdvocate: ArgumentState = {
      ...state,
      exchanges: [...state.exchanges, advocateExchange],
    }
    const read = readOpening(advocateText(withAdvocate), ontology)
    // Only pass a previous strategy when one actually existed. Handing over an empty id made the
    // first turn report "holding the same line", which was describing a switch that never happened.
    const previous = state.lastMoveId
      ? { id: state.lastMoveId, value: state.lastValue ?? 0 }
      : undefined
    const nextChoice = chooseStrategy(moves, read, ontology, previous)

    setInput('')
    setChoice(nextChoice)

    // Ground the turn in this attorney's own domain slice. The retriever filters, so a property
    // attorney cannot reach a contracts chunk even when it scores higher — which is the difference
    // between a dedicated profile and one long prompt that happens to say "property".
    let grounding = ''
    try {
      const passages = await window.seniorPartner?.ragSearch?.({
        query: `${text} ${nextChoice.primary.move.claim}`,
        topK: 4,
        domain: attorney.domain,
      })
      const hits = (passages?.hits ?? []).filter(
        (hit) => !hit.domain || hit.domain === attorney.domain,
      )
      setGrounded(hits.map((hit) => ({ source: hit.source, title: hit.title })))
      grounding = hits
        .map((hit, index) => `[${index + 1}] ${hit.source} — ${hit.title}\n${hit.excerpt}`)
        .join('\n\n')
    } catch {
      setGrounded([])
    }

    const spoken = await phraseTurn(
      nextChoice.primary.move,
      nextChoice.reason,
      read,
      advocateText(withAdvocate),
      state.round + 1,
      grounding,
    )

    const attorneyExchange: Exchange = {
      id: crypto.randomUUID(),
      speaker: 'attorney',
      text: spoken,
      moveId: nextChoice.primary.move.id,
      value: nextChoice.primary.value,
      switched: Boolean(nextChoice.switchedFrom),
    }

    setState({
      ...withAdvocate,
      exchanges: [...withAdvocate.exchanges, attorneyExchange],
      lastMoveId: nextChoice.primary.move.id,
      lastValue: nextChoice.primary.value,
      round: state.round + 1,
    })
    setBusy(false)
    speak(spoken)
  }

  function openArgument() {
    const read = readOpening('', ontology)
    const opening = chooseStrategy(moves, read, ontology)
    setState({ domain, exchanges: [], round: 0 })
    setChoice(opening)
    setNotice(
      `${attorney.name} is appearing for ${ontology.label}. Give your opening statement; ${attorney.name.split(' ').slice(-1)[0]} will read it before replying.`,
    )
  }

  function reset(nextDomain: DomainId) {
    setDomain(nextDomain)
    setState(null)
    setChoice(null)
    setInput('')
    setNotice(null)
    setSpeaking(false)
    window.speechSynthesis?.cancel()
  }

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8">
      <header className="border-b border-outline-variant pb-6">
        <p className="label-micro">Live oral argument · Adaptive</p>
        <h1 className="text-4xl font-serif mt-3 leading-tight text-on-surface">
          A dedicated attorney for each domain
        </h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-3xl">
          Select a domain and one attorney appears — bound to that doctrine, that move library, and
          that voice. They read your opening before replying, and switch their own strategy when
          what you said costs them a premise.
        </p>
      </header>

      {/* ── Domain ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {DOMAIN_CHOICES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => reset(option.id)}
            className={`px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              domain === option.id
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            {option.label}
          </button>
        ))}
        <span className="citation ml-auto">
          {voiceServer === 'up'
            ? 'local voice server detected'
            : voiceServer === 'down'
              ? 'using the system speech engine'
              : 'checking voice…'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
        {/* ── Argument ───────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <div className="border border-outline-variant bg-surface">
            <div className="px-5 py-4 border-b border-outline-variant flex items-start justify-between gap-4">
              <div>
                <p className="label-micro">{attorney.title}</p>
                <p className="font-serif text-xl text-on-surface mt-1">{attorney.name}</p>
                <p className="citation mt-1">
                  {attorney.temperament.join(' · ')} · {attorney.ollamaModel}
                </p>
                <p className="citation mt-1">
                  {scope
                    ? `${scope.chunks.toLocaleString()} passages · ${scope.sources} sources in ${ontology.label.toLowerCase()}`
                    : 'knowledge scope unavailable'}
                </p>
              </div>
              <button
                type="button"
                onClick={openArgument}
                className="shrink-0 px-4 py-2 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity"
              >
                {state ? 'Restart' : 'Take the podium'}
              </button>
            </div>

            <div
              ref={transcriptRef}
              className="h-[380px] overflow-y-auto px-5 py-4 space-y-4"
              data-testid="argument-transcript"
            >
              {!state && (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-5xl text-outline-variant">gavel</span>
                  <p className="font-serif text-xl text-on-surface">The bench is not yet called</p>
                  <p className="text-sm max-w-sm leading-relaxed">
                    {attorney.name} does not argue outside {ontology.label.toLowerCase()}; asked
                    about {attorney.refuses.outside.toLowerCase()}, she refers the matter to{' '}
                    {attorney.refuses.to}.
                  </p>
                </div>
              )}

              {state?.exchanges.map((exchange) => (
                <div
                  key={exchange.id}
                  className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                    exchange.speaker === 'advocate'
                      ? 'ml-auto bg-primary text-on-primary'
                      : 'bg-surface-container-low text-on-surface border border-outline-variant'
                  }`}
                >
                  <p className={`label-micro mb-1.5 ${exchange.speaker === 'advocate' ? 'text-on-primary/60' : ''}`}>
                    {exchange.speaker === 'advocate' ? 'You' : attorney.name}
                    {exchange.switched ? ' · switched strategy' : ''}
                  </p>
                  <p className="whitespace-pre-wrap">{exchange.text}</p>
                  {exchange.moveId && (
                    <p className={`citation mt-2 ${exchange.speaker === 'advocate' ? 'text-on-primary/60' : ''}`}>
                      {exchange.moveId} · value {exchange.value}
                    </p>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="citation">{attorney.name} is reading it…</span>
                </div>
              )}
            </div>

            <div className="border-t border-outline-variant p-4 space-y-3">
              {/* Voice controls. The stock engine voice reads slowly and flat, which is the
                  difference between "I can listen to this argument" and "I cannot". */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-outline-variant pb-3">
                <span className="label-micro">Voice</span>
                <select
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  aria-label="Voice"
                  className="bg-surface-container-low rounded-lg px-2.5 py-1.5 text-xs outline-none border border-outline-variant/20 focus:border-primary transition-colors max-w-[15rem]"
                >
                  {voices.length === 0 && <option value="">System default</option>}
                  {voices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} · {voice.lang}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2">
                  <span className="label-micro">Speed</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.8}
                    step={0.05}
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    aria-label="Speaking rate"
                    className="w-28 accent-current"
                  />
                  <span className="citation w-8 text-right">{rate.toFixed(2)}</span>
                </label>

                <label className="flex items-center gap-2">
                  <span className="label-micro">Pitch</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.05}
                    value={pitch}
                    onChange={(e) => setPitch(Number(e.target.value))}
                    aria-label="Pitch"
                    className="w-20 accent-current"
                  />
                  <span className="citation w-8 text-right">{pitch.toFixed(2)}</span>
                </label>

                <button
                  type="button"
                  onClick={() =>
                    speak(
                      `Good morning. My name is ${attorney.name.replace('Prof. ', 'Professor ')}, and I appear for the respondent in this matter.`,
                    )
                  }
                  disabled={speaking}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
                >
                  Test
                </button>

                {voices.length <= 2 && (
                  <span className="citation w-full">
                    Only one or two voices are installed. Windows adds better ones under Settings →
                    Time &amp; language → Speech.
                  </span>
                )}
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                rows={3}
                disabled={!state || busy}
                placeholder={
                  state
                    ? 'State the premise you are willing to defend…'
                    : 'Take the podium first.'
                }
                className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all resize-none disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={!state || !speechRecognitionAvailable}
                  title={
                    speechRecognitionAvailable
                      ? 'Dictate your argument'
                      : 'This build has no speech recognition; type instead'
                  }
                  aria-label={listening ? 'Stop dictation' : 'Dictate'}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider border transition-colors disabled:opacity-40 ${
                    listening
                      ? 'bg-accent text-on-accent border-accent'
                      : 'border-outline-variant text-on-surface-variant hover:border-primary/40'
                  }`}
                >
                  {listening ? 'Stop dictation' : 'Dictate'}
                </button>
                <button
                  type="button"
                  onClick={() => state && speak(state.exchanges.filter((e) => e.speaker === 'attorney').slice(-1)[0]?.text ?? '')}
                  disabled={!state || speaking}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
                >
                  {speaking ? 'Speaking…' : 'Replay'}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!state || busy || !input.trim()}
                  className="ml-auto px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {busy ? '…' : 'Argue →'}
                </button>
              </div>
              {notice && (
                <p className="text-[13px] text-on-surface-variant leading-snug border-l-2 border-accent pl-3">
                  {notice}
                </p>
              )}
            </div>
          </div>

          {grounded.length > 0 && (
            <div className="border border-outline-variant bg-surface-container-low p-4">
              <p className="label-micro">Grounded in — {attorney.domain} only</p>
              <ul className="mt-2 space-y-1">
                {grounded.map((hit) => (
                  <li key={`${hit.source}-${hit.title}`} className="citation truncate">
                    {hit.source} — {hit.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Possibility graph ──────────────────────────────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-6">
          <div className="border border-outline-variant bg-surface">
            <div className="px-5 py-3 border-b border-outline-variant">
              <p className="label-micro">Possibility graph</p>
              <p className="citation mt-1">
                {moves.length} moves · {ontology.elements.length} elements
              </p>
            </div>

            <div className="p-5 space-y-3">
              {!state && (
                <p className="text-[13px] text-on-surface-variant leading-relaxed">
                  The graph is scored against what the other side has committed to. Nothing is
                  chosen until your opening gives the attorney something to read.
                </p>
              )}

              {state && choice && (
                <>
                  {choice.switchedFrom && (
                    <div className="bg-accent text-on-accent p-3 space-y-1">
                      <p className="label-micro text-on-accent/70">Strategy switch</p>
                      <p className="text-[13px] leading-snug">
                        Abandoned {choice.switchedFrom.move.id} ({choice.switchedFrom.value}) for{' '}
                        {choice.primary.move.id} ({choice.primary.value})
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="label-micro">Currently arguing</p>
                    <p className="font-serif text-lg text-on-surface leading-tight mt-1">
                      {choice.primary.move.kind}
                    </p>
                    <p className="text-[13px] text-on-surface-variant leading-snug mt-1">
                      {choice.primary.move.claim}
                    </p>
                    <p className="citation mt-1.5">{choice.primary.move.authority}</p>
                  </div>

                  <div className="hairline-t pt-3 space-y-2">
                    <p className="label-micro">Why</p>
                    <p className="text-[13px] text-on-surface-variant leading-snug">
                      {choice.reason}
                    </p>
                  </div>

                  <div className="hairline-t pt-3 space-y-2">
                    <p className="label-micro">Alternates</p>
                    {choice.alternates.map((alternate) => (
                      <div key={alternate.move.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="citation truncate">{alternate.move.id}</p>
                          <span className="citation ml-auto">{alternate.value}</span>
                        </div>
                        <div className="h-1 bg-surface-container-high">
                          <div
                            className="h-full bg-outline"
                            style={{ width: `${Math.max(0, Math.min(100, alternate.value))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="border border-outline-variant bg-surface-container-low p-5 space-y-2">
            <p className="label-micro">Domain boundary</p>
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              {attorney.name} argues {ontology.label.toLowerCase()} only. {attorney.openingDiscipline}
            </p>
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              Will not fight on: {attorney.weakGround}
            </p>
            <p className="citation pt-1">Profile: {attorney.sourceProfile}</p>
            <p className="citation">Bench auditor: {BENCH.name}</p>
          </div>

          <div className="border border-outline-variant bg-surface-container-low p-5 space-y-2">
            <p className="label-micro">The frame being fought inside</p>
            <p className="text-[13px] text-on-surface leading-relaxed">{ontology.frame}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
