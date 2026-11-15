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
      aiFormatBia: (args: { text: string; mode?: string; turn?: 'drill' | 'evaluation' }) => Promise<{ success: boolean; biaHtml?: string | null; passthrough?: boolean; error?: string }>
      /** Fired whenever a BIA artifact is produced. */
      onAiBia: (cb: (data: { html: string; mode?: string }) => void) => void
      /* ── Persistent chat threads (Part 4) ─────────────────────────────────── */
      /** Load a thread, walking backward through days within a token budget. */
      loadChatThread: (args: { action: string; maxTokens?: number }) => Promise<{ success: boolean; messages: ChatStoredMessage[]; daysLoaded?: number; tokens?: number; budget?: number; truncated?: boolean; oldestLoaded?: string | null; error?: string }>
      /** Append one turn to today's file for an action (append-only). */
      appendChatTurn: (args: { action: string; role: 'user' | 'assistant'; content: string; id?: string; reasoning?: string | null; biaHtml?: string | null }) => Promise<{ success: boolean; file?: string; dateKey?: string; ts?: string; id?: string; error?: string }>
      /**
       * Delete one turn by id. Writes a tombstone in the main process, so the deletion survives a
       * reload -- a renderer-only delete is what let deleted messages come back.
       */
      deleteChatTurn: (args: { action: string; id: string }) => Promise<{ success: boolean; id?: string; error?: string }>
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
      /** Counts and generation metadata for the bundled legal corpora */
      ragStats:            () => Promise<{
        success: boolean
        chunkCount?: number
        sourceCount?: number
        corpora?: Array<{ file: string; chunks: number; version: string | null; generatedAt: string | null }>
        topSources?: Array<{ source: string; count: number }>
        /** Chunk counts per practice domain — the partition each attorney is bound to */
        domains?: Record<string, number>
        domainSourceCounts?: Record<string, number>
        error?: string
      }>
      /** Which news providers are configured, and how current the doctrine corpus is */
      realWorldStatus:     () => Promise<{
        ok: boolean
        providers?: { rss: boolean; topic: boolean; oxylabs: boolean }
        corpus?: { chunks: number; domains: Record<string, number>; generatedAt: string | null }
        /** What the library holds by foundational subject, so gaps are visible */
        coverage?: Array<{ label: string; chunks: number; present: boolean }>
        error?: string
      }>
      /** Search current news and correlate each headline to doctrine passages */
      realWorldSearch:     (args: {
        query?: string
        topicId?: string
        domain?: string | null
        limit?: number
        provider?: 'rss' | 'topic' | 'oxylabs'
      }) => Promise<{
        ok: boolean
        provider?: string
        note?: string
        error?: string
        items: Array<{
          title: string
          link: string
          published: string
          outlet: string
          doctrine: Array<{ source: string; title: string; excerpt: string; domain?: string; score: number }>
          relaxed?: boolean
          note?: string | null
          corpusGeneratedAt?: string | null
        }>
      }>
      /** Store Oxylabs Web API credentials (optional provider) */
      realWorldSaveCredentials: (args: { username: string; password: string }) => Promise<{ success: boolean; error?: string }>
      /** Generate a run of exam questions grounded in the corpus */
      examGenerate: (args: {
        domain?: string
        kind?: 'mcq' | 'written' | 'essay'
        difficulty?: 'foundational' | 'midterm' | 'exam'
        count?: number
        /** A free-text topic. Overrides `domain` and searches every shelf. */
        topic?: string
        allSources?: boolean
        /** 'bar' reproduces the Florida examination; 'final' is a law-school final. */
        mode?: 'bar' | 'final'
        /** One of the Florida Board of Bar Examiners' sixteen subjects, or an MBE subject. */
        subject?: string
        /** Part A (Florida), Part B (Multistate), or both split evenly. */
        part?: 'A' | 'B' | 'both'
      }) => Promise<{
        success: boolean
        mode?: 'bar' | 'final'
        part?: 'A' | 'B' | 'both'
        subject?: string | null
        domain?: string | null
        allSources?: boolean
        topic?: string | null
        label?: string
        /** Corpus sources the passages came from, so the grounding is auditable */
        sources?: string[]
        kind?: string
        requested?: number
        returned?: number
        error?: string
        questions: Array<{
          id: string
          kind: string
          prompt: string
          options?: string[]
          answerIndex?: number
          modelAnswer?: string
          rubric?: string[]
          hint: string
          rationale: string
          doctrine: string
        }>
      }>
      ragSearch:           (args: { query: string; topK?: number; domain?: string }) => Promise<{
        success: boolean
        domain?: string | null
        /** True when the search had to loosen the query to return anything */
        relaxed?: boolean
        /** Plain-language explanation of what was loosened, for display */
        note?: string | null
        hits: Array<{ id: string; source: string; title: string; domain?: string; excerpt: string; score: number }>
        error?: string
      }>
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

      /* ── Boot diagnostics (renderer → boot.log) ── */
      /** Report a genuine React mount. The only signal that proves the bundle ran. */
      rendererMounted: () => void
      /** Report an uncaught renderer error so it reaches boot.log instead of nowhere. */
      bootFault: (payload: { kind: string; detail: string }) => void
      /** Tell the main process whether an unsaved outline is open (quit guard). */
      setUnsaved: (flag: boolean) => void
      /** Resolve the quit guard and exit the app. */
      exitNow: () => Promise<{ success: boolean }>

      /* ── Local Document Vault (works with no Supabase project) ── */
      vaultSave:       (args: { topic: string; subject: string; mode: string; tags?: string[]; html: string }) =>
                         Promise<{ success: boolean; record?: unknown; dir?: string; error?: string }>
      vaultList:       () => Promise<{ success: boolean; records: unknown[]; dir?: string; error?: string }>
      vaultRead:       (args: { id: string }) =>
                         Promise<{ success: boolean; record?: unknown; html?: string; error?: string }>
      vaultUpdate:     (args: { id: string; tags?: string[]; topic?: string }) =>
                         Promise<{ success: boolean; record?: unknown; error?: string }>
      vaultDelete:     (args: { id: string }) => Promise<{ success: boolean; error?: string }>
      vaultOpenFolder: () => Promise<{ success: boolean }>

      /* ── Offline mode (works with no network and no API key) ── */
      /**
       * Answer from the bundled Florida Statutes. `text` is always present so the caller can
       * render it as plain text; `citation` and `integrity` let the UI show provenance and
       * warn when a bundled section is known to be an imperfect copy.
       */
      offlineAsk: (text: string) => Promise<{
        ok: boolean
        source: 'offline'
        type: 'rule-lookup' | 'definition' | 'reflection' | 'clarify' | 'unavailable' | 'error'
        agent?: string
        text: string
        citation?: { section: string; catchline: string; source: string | null; file: string } | null
        integrity?: { ok: boolean; note?: string; anomalies?: string[] }
        suggestions?: string[]
        doctrine?: { id: string; label: string } | null
        /** Where the quoted text came from: the bundled snapshot, or a copy verified against flsenate.gov. */
        provenance?: { origin: 'overlay' | 'bundle'; verified_at: string | null; source_url: string | null; hash: string | null }
        /** Present when a second discipline also claimed the question. */
        note?: string
        arbitration?: { resolvedBy: string; note?: string }
        /** Set instead of a single answer when two disciplines genuinely tied; show both, labelled. */
        merged?: { id: string; label: string; response: unknown }[]
      }>

      /* ── Corpus verification against the live source ──
         Never called on a normal ask. The bundled corpus answers by default; the network is used
         only when a section was flagged damaged, or the user explicitly asked to verify one. */
      corpusVerifySection: (sectionNumber: string) => Promise<{
        ok: boolean
        section?: string
        error?: string
        message?: string
        /** True for a DNS/connection failure. The bundled copy still answers; it just stays unverified. */
        offline?: boolean
        source_url?: string
        verified_on?: string
        matches?: boolean
        diff?: { field: string; cached: string; live: string; cached_len?: number; live_len?: number }[]
        live?: { section: string; catchline: string; body: string; history: string | null; note: string | null }
        cached?: { found: boolean; catchline?: string | null; body?: string | null; provenance?: { origin: string; verified_at: string | null } | null }
      }>

      corpusRepairSection: (sectionNumber: string) => Promise<{
        ok: boolean
        section?: string
        error?: string
        message?: string
        authority?: string
        overlay?: { markdown_path: string; meta_path: string; meta: { verified_at: string; source_url: string | null } }
      }>

      corpusOverlayStatus: () => Promise<{
        root: string | null
        count: number
        sections: { section: string; verified_at: string | null; source_url: string | null; edition: string | null }[]
        rate?: { minIntervalMs: number; maxPerMinute: number; inWindow: number }
        edition?: string
      }>

      corpusRevertSection: (sectionNumber: string) => Promise<{ ok: boolean; removed: boolean }>

      /* ── Export (Word / PDF / HTML / Markdown) ── */
      exportDocument:  (args: {
                         topic: string; subject: string; mode: string; html: string;
                         format: 'docx' | 'pdf' | 'html' | 'md'; filePath?: string;
                       }) => Promise<{ success: boolean; filePath?: string; format?: string; canceled?: boolean; error?: string }>

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
      icmVerify:     (args?: { query?: string }) => Promise<{ success: boolean; query?: string; filesIndexed?: number; byDiscipline?: Record<string, number>; byDocType?: Record<string, number>; matched?: boolean; scope?: string; refusalReason?: string; hits?: { rel: string; discipline: string; docType: string; score: number }[]; injectedBlockLength?: number; injectedBlockPrefix?: string; blockOrderedBeforeRag?: boolean; error?: string }>
      /* ── Whiteboard ────────────────────────────────────────────────────────── */
      whiteboardList:    () => Promise<{ success: boolean; items: { file: string; name: string; title: string; bytes: number; mtime: number; hasPng: boolean; hasMd: boolean }[]; dir?: string; error?: string }>
      whiteboardLoad:    (args: { file: string }) => Promise<{ success: boolean; file?: string; scene?: unknown; text?: string[]; pngDataUrl?: string | null; error?: string }>
      whiteboardSave:    (args: { title?: string; scene?: unknown; pngBase64?: string | null }) => Promise<{ success: boolean; file?: string; stem?: string; dir?: string; jsonPath?: string; pngPath?: string; mdPath?: string; textCount?: number; elementCount?: number; error?: string }>
      whiteboardConvert: (args: { text: string; title?: string }) => Promise<{ success: boolean; outline?: string; docxPath?: string | null; chars?: number; reason?: string; error?: string }>
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
    id?: string | null
    role: 'user' | 'assistant' | string
    content: string
    /** R1's chain-of-thought, delimited in the file so it cannot be confused with the answer. */
    reasoning?: string | null
    /** The formatted four-tier artifact. Absent when the formatter was skipped or failed. */
    biaHtml?: string | null
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
