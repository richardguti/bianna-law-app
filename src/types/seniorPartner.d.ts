/**
 * Canonical ambient declaration for the Electron preload bridge exposed by
 * jsons/preload.js via contextBridge.exposeInMainWorld('seniorPartner', {…}).
 *
 * Declared once here so the shape cannot drift between pages — previously
 * Settings.tsx and StudySessions.tsx each declared a partial `Window.seniorPartner`,
 * which produced conflicting global-interface merges (TS2717).
 */
export {}

declare global {
  interface Window {
    seniorPartner?: {
      /* ── API keys ────────────────────────────────────────────────────────── */
      apiKeyExists: () => Promise<boolean>
      apiKeySave:   (key: string) => Promise<{ success: boolean; error?: string }>
      apiKeyClear:  () => Promise<{ success: boolean }>

      /* ── AI prompts & documents ──────────────────────────────────────────── */
      aiPromptSend:     (args: { prompt: string; systemPrompt?: string; mode?: string; modelPreference?: string }) => Promise<{ success: boolean; response?: string; error?: string }>
      aiPromptStream:   (args: { prompt?: string; systemPrompt?: string; messages?: { role: string; content: string }[]; mode?: string; modelPreference?: string; maxTokens?: number; streamId?: string; formatStrict?: boolean }) => Promise<{ success: boolean; response?: string; reasoning?: string; usedFormatter?: boolean; truncated?: boolean; aborted?: boolean; streamId?: string; error?: string }>
      /** Structured JSON generation via the staged pipeline + domain validation */
      aiStructured:     (args: { prompt?: string; systemPrompt?: string; messages?: { role: string; content: string }[]; mode?: string; maxTokens?: number; requiredKeys?: string[]; schemaHint?: string; validate?: string }) => Promise<{ success: boolean; text?: string; error?: string }>
      /** Cancel an in-flight stream (Stop button) */
      aiAbort:          (streamId?: string) => Promise<{ success: boolean; streamId?: string; error?: string }>
      /* ── Unified BIA rendering for chat surfaces ──────────────────────────── */
      /**
       * Reformat a finished answer into the house four-tier stylesheet. The returned HTML
       * MUST be passed through sanitizeBia before it reaches the DOM.
       */
      aiFormatBia: (args: { text: string; mode?: 'chat' | 'outline' }) => Promise<{ success: boolean; biaHtml?: string; error?: string }>
      /** Fired whenever a BIA artifact is produced. */
      onAiBia: (cb: (data: { html: string; mode?: string }) => void) => void
      /* ── Persistent chat threads (Part 4) ─────────────────────────────────── */
      /** Load a thread, walking backward through days within a token budget. */
      loadChatThread: (args: { action: string; maxTokens?: number }) => Promise<{ success: boolean; messages: ChatStoredMessage[]; daysLoaded?: number; tokens?: number; budget?: number; truncated?: boolean; oldestLoaded?: string | null; error?: string }>
      /** Append one turn to today's file for an action (append-only). */
      appendChatTurn: (args: { action: string; role: 'user' | 'assistant'; content: string }) => Promise<{ success: boolean; file?: string; dateKey?: string; ts?: string; error?: string }>
      /** Day keys holding a thread for an action, newest first. */
      listChatDays:   (args: { action: string }) => Promise<{ success: boolean; days: string[]; error?: string }>
      /** Search every stored conversation. */
      recallChat:     (args: { query: string; limit?: number; maxDays?: number }) => Promise<{ success: boolean; relevant: { action: string; date: string; role: string; ts: string; score: number; excerpt: string }[]; error?: string }>
      /* ── YouTube playlist pipeline ────────────────────────────────────────── */
      /** Cancel an in-flight playlist run. */
      cancelYoutubePlaylist: () => Promise<{ success: boolean }>
      /**
       * Progress for the playlist pipeline. `stage` is one of: fetching-playlist,
       * playlist-resolved, fetching-transcripts, transcripts-ready, generating-outline,
       * saving, done, error. `message` is human-readable; `current`/`total` drive the bar.
       */
      onPlaylistProgress: (cb: (data: { stage: string; message?: string; current?: number; total?: number; skipped?: number; filePath?: string; fileName?: string; outline?: string }) => void) => void
      /** Fires when a pipeline saved a new document, so the Vault can refresh itself. */
      onVaultNewFile: (cb: (data: { filePath: string; fileName: string }) => void) => void
      onAiChunk:        (cb: (data: { delta: string; streamId?: string }) => void) => void
      onAiReasoning:    (cb: (data: { delta: string; streamId?: string }) => void) => void
      /** `{ stage: 'formatting', reset: true }` — discard typed text before the finished artifact arrives. */
      onAiStage:        (cb: (data: { stage: string; reset?: boolean }) => void) => void
      getModelPreference: () => Promise<'reasoner' | 'chat' | 'gemini'>
      setModelPreference: (pref: string) => Promise<{ success: boolean; preference?: string; error?: string }>
      /* ── UI preferences (theme + palette) ────────────────────────────────── */
      getUiPreferences:   () => Promise<UiPreferences>
      setUiPreferences:   (prefs: Partial<UiPreferences>) => Promise<{ success: boolean; preferences: UiPreferences }>
      /* ── Editable preset fields (custom chip values) ──────────────────────── */
      /** Custom values persisted per surface, e.g. { storageKey: 'outline-generator/subject' } */
      editableFieldsGet:           (args: { storageKey: string }) => Promise<{ success: boolean; customValues: string[]; value?: string; error?: string }>
      editableFieldsAddCustom:     (args: { storageKey: string; value: string }) => Promise<{ success: boolean; customValues: string[]; error?: string }>
      editableFieldsRemoveCustom:  (args: { storageKey: string; value: string }) => Promise<{ success: boolean; customValues: string[]; error?: string }>
      /** Remember the current selection (surfaces whose value is free text). */
      editableFieldsSetValue:      (args: { storageKey: string; value: string }) => Promise<{ success: boolean; error?: string }>
      /** One-shot migration of pre-1.2.0 custom values; reports how many were moved. */
      editableFieldsMigrateLegacy: (args: { storageKey: string; values: string[] }) => Promise<{ success: boolean; customValues: string[]; migrated: number; error?: string }>
      resetUiPreferences: () => Promise<{ success: boolean; preferences: UiPreferences }>
      prefersDark:        () => boolean
      generateDocument: (args: unknown) => Promise<{ success: boolean; filePath?: string; error?: string }>
      openSettings:     () => Promise<{ success: boolean }>

      /* ── Files ───────────────────────────────────────────────────────────── */
      getAppVersion:       () => Promise<string>
      openDocumentsFolder: () => Promise<{ success: boolean }>
      listRagSources:      () => Promise<unknown>
      pickAndReadFile:     () => Promise<{ success: boolean; text?: string; fileName?: string; filePath?: string; canceled?: boolean; noText?: boolean; error?: string }>
      /** Resolve the real path of a dropped File (Electron ≥32) — null when unavailable */
      getPathForFile:      (file: File) => string | null
      /** Extract text from a known path (.pdf/.docx/.txt/.md) */
      readFileText:        (filePath: string, maxChars?: number) => Promise<{ success: boolean; text?: string; fileName?: string; filePath?: string; canceled?: boolean; noText?: boolean; error?: string }>
      listBiannaFiles:     () => Promise<unknown>
      openBiannaFile:      (filePath: string) => Promise<unknown>
      previewFile:         (filePath: string) => Promise<unknown>
      scanLegalFiles:      () => Promise<unknown>

      /* ── Notion ──────────────────────────────────────────────────────────── */
      notionKeyExists:   () => Promise<boolean>
      notionKeySave:     (key: string) => Promise<{ success: boolean; error?: string }>
      notionKeyClear:    () => Promise<{ success: boolean }>
      notionSyncSummary: (args: unknown) => Promise<unknown>
      notionSyncQuiz:    (args: unknown) => Promise<unknown>
      organizeSyllabus:  (args: { syllabusText: string; courseName?: string }) => Promise<unknown>

      /* ── YouTube ─────────────────────────────────────────────────────────── */
      extractYoutubeTranscript: (videoUrl: string) => Promise<unknown>
      /** Playlist pipeline. Accepts either key: the renderer sends `url`. */
      processYoutubePlaylist:   (args: { url?: string; playlistUrl?: string }) => Promise<{ success: boolean; outlineText?: string; fileName?: string; filePath?: string; videoCount?: number; totalFound?: number; urlType?: string; elapsedMs?: number; error?: string }>
      onPlaylistProgress:       (cb: (data: unknown) => void) => void

      /* ── Persistent study memory (local files) ───────────────────────────── */
      memoryWrite:  (args: { content: string; type?: string; heading?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
      memorySearch: (args: { query: string; limit?: number }) => Promise<{ success: boolean; results?: { file: string; line: number; text: string }[]; error?: string }>

      /* ── Capture: chunked + staged document analysis ───────────────────────── */
      captureAnalyze: (args: { text: string; sourceLabel?: string; systemPrompt: string; schemaHint?: string }) => Promise<{ success: boolean; text?: string; chunks?: number; finishReason?: string; error?: string }>

      /* ── Profile & Calendar persistence ────────────────────────────────────── */
      profileGet:   () => Promise<{ success: boolean; profile: UserProfile | null }>
      profileSave:  (profile: UserProfile) => Promise<{ success: boolean; error?: string }>
      calendarGet:  () => Promise<{ success: boolean; events: unknown[] }>
      calendarSave: (events: unknown[]) => Promise<{ success: boolean; error?: string }>

      /* ── Diagnostics, calendar & generic channel ─────────────────────────── */
      getDiagnostics:      () => Promise<{ apiKeyPresent?: boolean; [key: string]: unknown }>
      openExternalUrl:     (url: string) => Promise<unknown>
      syncGoogleCalendar:  (events: unknown[]) => Promise<unknown>
      on:                  (channel: string, cb: (...args: unknown[]) => void) => void

      /* ── ICM (user's own mirrored corpus) & OCR ───────────────────────────── */
      icmSync:       (args?: { root?: string }) => Promise<{ success?: boolean; scanned?: number; added?: number; updated?: number; reused?: number; indexed?: number; canceled?: boolean; stats?: IcmStats; error?: string }>
      icmChooseRoot: () => Promise<{ success?: boolean; scanned?: number; indexed?: number; canceled?: boolean; stats?: IcmStats; error?: string }>
      icmStats:      () => Promise<IcmStats>
      icmList:       (args?: { limit?: number }) => Promise<{ rel: string; discipline: string; docType: string; chars: number; path: string }[]>
      icmSearch:     (args?: { query?: string; topK?: number }) => Promise<{ score: number; path: string; rel: string; discipline: string; docType: string; excerpt: string }[]>
      icmIndexFile:  (filePath: string) => Promise<{ success: boolean; error?: string }>
      icmVerify:     (args?: { query?: string }) => Promise<{ success: boolean; query?: string; filesIndexed?: number; byDiscipline?: Record<string, number>; byDocType?: Record<string, number>; matched?: { rel: string; discipline: string; docType: string; score: number }[]; injectedBlockLength?: number; injectedBlockPrefix?: string; blockOrderedBeforeRag?: boolean; error?: string }>
      /** First-launch install of the bundled Florida Statutes into the user's corpus */
      corpusEnsure:  (args?: { force?: boolean }) => Promise<{ ok: boolean; skipped?: boolean; installed?: number; total?: number; ms?: number; version?: string; dest?: string; files?: number; reason?: string; error?: string }>
      corpusStatus:  () => Promise<{ bundled: string | null; bundledVersion: string | null; bundledFiles: number; installed: string; installedVersion: string | null; installedFiles: number; expectedVersion: string }>
      onCorpusInstallProgress: (cb: (data: { done: number; total: number }) => void) => void
      ocrImage:      (base64: string) => Promise<{ success: boolean; available: boolean; text?: string; error?: string }>

      [key: string]: unknown
    }
  }

  interface IcmStats {
    root?: string
    updatedAt?: string | null
    files: number
    indexedChars?: number
    byDiscipline: Record<string, number>
    byDocType: Record<string, number>
    unavailable?: boolean
  }

  /** One stored chat turn, as written to the markdown thread files. */
  interface ChatStoredMessage {
    role: 'user' | 'assistant' | string
    content: string
    ts: string
    date: string
  }

  interface UserProfile {
    name: string
    school: string
    year: string
    email: string
    photoBase64: string | null
  }

  /** Theme + palette preferences (null colour = use the theme default). */
  interface UiPreferences {
    theme: 'light' | 'dark' | 'system'
    background: string | null
    surface: string | null
    primary: string | null
    text: string | null
  }
}
