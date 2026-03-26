import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, type CaptureRow } from '../lib/supabase'
import { useAppStore } from '../store/appStore'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'

type DetectedType = 'notes' | 'syllabus' | 'case_printout' | 'checklist' | 'unknown'

const CAPTURE_SYSTEM = `You are analyzing a law student's uploaded document or photograph. Extract all text and classify the content.

Respond ONLY with valid JSON (no markdown):
{
  "extractedText": "full extracted text here",
  "detectedType": "notes|syllabus|case_printout|checklist|unknown",
  "suggestedActions": ["outline", "case_brief", "tracker", "irac_drill", "checklist", "chat"],
  "summary": "one sentence describing the content"
}`

const ACTION_CARDS = [
  { id: 'outline',    icon: 'architecture',  label: 'Generate Outline',       desc: 'Build a Bia-style 4-tier outline from this content.' },
  { id: 'case_brief', icon: 'gavel',         label: 'Create Case Brief',       desc: 'Extract Citation, Facts, Issue, Holding, Rule of Law.' },
  { id: 'tracker',   icon: 'check_box',     label: 'Add to Reading Tracker',  desc: 'Mark extracted cases as read in your tracker.' },
  { id: 'irac_drill', icon: 'school',        label: 'Start IRAC Drill',        desc: 'Use this content as a Socratic fact pattern.' },
  { id: 'checklist', icon: 'fact_check',    label: 'Checklist Audit',         desc: 'Cross-reference against your outlines for gaps.' },
  { id: 'chat',      icon: 'chat',          label: 'Ask a Question',          desc: 'Open a chat with this content as full context.' },
] as const

type ActionId = typeof ACTION_CARDS[number]['id']

type PlaylistProgress = {
  stage:    'extracting' | 'generating' | 'saving' | 'done' | 'error'
  current?: number
  total?:   number
  title?:   string
  message?: string
  outline?: string
  filePath?: string
}

export function Capture() {
  const navigate  = useNavigate()
  const apiKey    = useAppStore((s) => s.apiKey)
  const fileRef   = useRef<HTMLInputElement>(null)

  const [dragging,       setDragging]       = useState(false)
  const [processing,     setProcessing]     = useState(false)
  const [extractedText,  setExtractedText]  = useState<string | null>(null)
  const [detectedType,   setDetectedType]   = useState<DetectedType>('unknown')
  const [summary,        setSummary]        = useState<string>('')
  const [suggested,      setSuggested]      = useState<string[]>([])
  const [error,          setError]          = useState<string | null>(null)

  // ── YouTube Playlist → Outline ──────────────────────────────────────────────
  const [playlistUrl,      setPlaylistUrl]      = useState('')
  const [playlistRunning,  setPlaylistRunning]  = useState(false)
  const [playlistProgress, setPlaylistProgress] = useState<PlaylistProgress | null>(null)
  const [playlistError,    setPlaylistError]    = useState<string | null>(null)
  const progressListenerRef = useRef(false)

  const { data: captures = [] } = useQuery<CaptureRow[]>({
    queryKey: ['captures'],
    queryFn: async () => {
      const { data } = await supabase
        .from('captures')
        .select('id, extracted_text, detected_type, action_taken, created_at')
        .eq('user_id', BIANNA_USER_ID)
        .order('created_at', { ascending: false })
        .limit(10)
      return (data ?? []) as CaptureRow[]
    },
  })

  async function processFile(file: File) {
    if (!apiKey) { setError('Add your Anthropic API key in Settings first.'); return }
    setProcessing(true)
    setError(null)
    setExtractedText(null)

    try {
      const isImage = file.type.startsWith('image/')
      let content: { type: string; [k: string]: unknown }

      if (isImage) {
        const base64 = await fileToBase64(file)
        content = { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } }
      } else {
        // Plain text files
        const text = await file.text()
        content = { type: 'text', text: `File: ${file.name}\n\n${text}` }
      }

      const res = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: claudeHeaders(apiKey),
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 4096,
          system:     CAPTURE_SYSTEM,
          messages:   [{ role: 'user', content: [content, { type: 'text', text: 'Analyze this document.' }] }],
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error?.message ?? `API error ${res.status}`)
      const raw     = data.content?.[0]?.text ?? ''
      // Extract the JSON object regardless of surrounding markdown fences or text
      const start   = raw.indexOf('{')
      const end     = raw.lastIndexOf('}')
      if (start < 0 || end < start) throw new Error('Claude returned an unexpected format. Try again.')
      const parsed  = JSON.parse(raw.slice(start, end + 1))

      setExtractedText(parsed.extractedText)
      setDetectedType(parsed.detectedType)
      setSummary(parsed.summary)
      setSuggested(parsed.suggestedActions ?? [])

      // Save to Supabase
      await supabase.from('captures').insert({
          user_id:        BIANNA_USER_ID,
          extracted_text: parsed.extractedText,
          detected_type:  parsed.detectedType,
          action_taken:   null,
          file_url:       null,
        } as any)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  async function handleAction(action: ActionId) {
    if (!extractedText) return

    if (action === 'outline') {
      // Pre-fill outline generator via sessionStorage
      sessionStorage.setItem('capture_notes', extractedText)
      navigate('/outline')
    } else if (action === 'irac_drill') {
      sessionStorage.setItem('capture_notes', extractedText)
      navigate('/sessions')
    } else if (action === 'chat') {
      sessionStorage.setItem('capture_notes', extractedText)
      navigate('/sessions')
    } else {
      // For other actions, show the text — user can manually act
      alert(`Content extracted. Copy and use in the ${action} workflow.`)
    }
  }

  async function handlePlaylistGenerate() {
    const url = playlistUrl.trim()
    if (!url) return
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      setPlaylistError('Please enter a valid YouTube playlist URL.')
      return
    }

    setPlaylistRunning(true)
    setPlaylistError(null)
    setPlaylistProgress({ stage: 'extracting', message: 'Starting…' })

    // Register progress listener once
    if (!progressListenerRef.current) {
      progressListenerRef.current = true
      ;(window as any).seniorPartner?.onPlaylistProgress?.((data: PlaylistProgress) => {
        setPlaylistProgress(data)
        if (data.stage === 'done' || data.stage === 'error') {
          setPlaylistRunning(false)
          if (data.stage === 'error') setPlaylistError(data.message ?? 'Unknown error')
        }
      })
    }

    const result = await (window as any).seniorPartner?.processYoutubePlaylist?.({ url })
    if (!result) {
      setPlaylistRunning(false)
      setPlaylistError('processYoutubePlaylist is not available. Please rebuild the app.')
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [apiKey])

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">Intelligence Layer</span>
        <h1 className="text-4xl font-serif mt-1 text-primary">Capture</h1>
        <p className="text-sm text-on-surface-variant mt-1">Photograph notes, a whiteboard, or a case printout → extract → AI action.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-colors cursor-pointer py-16 ${
          dragging
            ? 'border-primary bg-primary-fixed/30'
            : 'border-outline-variant/40 hover:border-primary/40 bg-surface-container-lowest'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.md"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0]) }}
        />
        {processing ? (
          <>
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm font-label uppercase tracking-widest text-on-surface-variant">Extracting text…</p>
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-5xl text-primary">photo_camera</span>
            <p className="font-serif text-xl text-on-surface">Photograph your notes, whiteboard, or case printout</p>
            <p className="text-sm text-on-surface-variant">Or drag and drop a PDF, image, or text file</p>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant/60">JPG · PNG · WEBP · PDF · TXT · MD</p>
          </>
        )}
      </div>

      {/* ── YouTube Playlist → Outline ────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/15 shadow-[var(--shadow-sm)] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-red-500">smart_display</span>
          <div>
            <p className="text-sm font-semibold text-on-surface">YouTube Playlist → Outline</p>
            <p className="text-xs text-on-surface-variant">Paste a playlist URL (e.g. Quimbee) — all video transcripts are processed into one outline saved to your Document Vault.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !playlistRunning && handlePlaylistGenerate()}
            placeholder="https://www.youtube.com/playlist?list=…"
            disabled={playlistRunning}
            className="flex-1 bg-surface-container-low border border-outline-variant/30 focus:border-primary rounded-full px-4 py-2 text-sm outline-none transition-all disabled:opacity-50"
          />
          <button
            onClick={handlePlaylistGenerate}
            disabled={playlistRunning || !playlistUrl.trim()}
            className="flex items-center gap-1.5 px-5 py-2 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity active:scale-95"
          >
            <span className="material-symbols-outlined text-base">
              {playlistRunning ? 'hourglass_empty' : 'auto_awesome'}
            </span>
            {playlistRunning ? 'Processing…' : 'Generate'}
          </button>
        </div>

        {/* Progress */}
        {playlistProgress && playlistProgress.stage !== 'done' && playlistProgress.stage !== 'error' && (
          <div className="space-y-2">
            {playlistProgress.stage === 'extracting' && playlistProgress.total && (
              <>
                <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(((playlistProgress.current ?? 0) / playlistProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-on-surface-variant">
                  Extracting transcripts: {playlistProgress.current}/{playlistProgress.total}
                  {playlistProgress.title && <> — <span className="italic">{playlistProgress.title}</span></>}
                </p>
              </>
            )}
            {playlistProgress.stage === 'generating' && (
              <p className="text-xs text-on-surface-variant animate-pulse">Generating outline with Claude…</p>
            )}
            {playlistProgress.stage === 'saving' && (
              <p className="text-xs text-on-surface-variant animate-pulse">Saving to Document Vault…</p>
            )}
          </div>
        )}

        {/* Success */}
        {playlistProgress?.stage === 'done' && (
          <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-green-500">check_circle</span>
              <p className="text-sm font-semibold text-green-700 dark:text-green-400">Outline saved to Document Vault!</p>
            </div>
            {playlistProgress.filePath && (
              <p className="text-[10px] text-on-surface-variant font-mono truncate">{playlistProgress.filePath}</p>
            )}
            {playlistProgress.outline && (
              <button
                onClick={() => {
                  sessionStorage.setItem('capture_notes', playlistProgress.outline!)
                  navigate('/outline')
                }}
                className="flex items-center gap-1.5 mt-2 px-4 py-2 bg-primary text-on-primary rounded-full text-xs font-semibold hover:opacity-90 transition-opacity active:scale-95"
              >
                <span className="material-symbols-outlined text-sm">architecture</span>
                Open in Outline Generator
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {playlistError && (
          <div className="text-xs text-red-500 bg-red-500/10 rounded-lg px-4 py-2">{playlistError}</div>
        )}
      </div>

      {error && (
        <div className="bg-error-container text-on-error-container rounded-xl px-5 py-4 text-sm">{error}</div>
      )}

      {/* Results */}
      {extractedText && !processing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Extracted text */}
          <div className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary-container text-on-primary-container`}>
                {detectedType.replace('_', ' ')}
              </span>
              <p className="text-xs text-on-surface-variant flex-1 italic">{summary}</p>
            </div>
            <textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              rows={10}
              className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-outline-variant/20 resize-none"
            />
          </div>

          {/* Action cards */}
          <div className="space-y-3">
            <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-4">What would you like to do?</p>
            {ACTION_CARDS.map((card) => (
              <button
                key={card.id}
                onClick={() => handleAction(card.id)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                  suggested.includes(card.id)
                    ? 'border-primary bg-primary-fixed/20 shadow-sm'
                    : 'border-outline-variant/20 bg-surface-container-lowest hover:border-primary/40 hover:bg-surface-container-low'
                }`}
              >
                <span className={`material-symbols-outlined text-2xl ${suggested.includes(card.id) ? 'text-primary' : 'text-on-surface-variant'}`}>
                  {card.icon}
                </span>
                <div>
                  <p className="text-sm font-semibold text-on-surface">{card.label}</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">{card.desc}</p>
                </div>
                {suggested.includes(card.id) && (
                  <span className="ml-auto text-[10px] bg-primary text-on-primary px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    Suggested
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Capture history */}
      {captures.length > 0 && (
        <div>
          <h2 className="font-serif text-xl text-primary mb-4">Recent Captures</h2>
          <div className="space-y-2">
            {captures.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-4 bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10 cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => { setExtractedText(c.extracted_text); setDetectedType(c.detected_type as DetectedType); setSuggested([]) }}
              >
                <span className="material-symbols-outlined text-primary-container">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-on-surface truncate">{c.extracted_text.slice(0, 80)}…</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">
                    {c.detected_type.replace('_', ' ')} · {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant text-base">arrow_forward</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
