/**
 * preload.js — Secure bridge between Electron main process and renderer.
 *
 * SECURITY MODEL:
 *  - contextIsolation: true  → renderer JS cannot access Node/Electron APIs directly
 *  - nodeIntegration: false  → no require() in renderer
 *  - Only explicitly whitelisted channels are exposed here via contextBridge
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('seniorPartner', {

  // ── API Key Management ─────────────────────────────────────────────────────
  /** Returns true/false — the key itself is NEVER sent to the renderer */
  apiKeyExists: () => ipcRenderer.invoke('api-key-exists'),
  /** Save a new API key (renderer sends it once; main stores it, never echoes back) */
  apiKeySave: (key) => ipcRenderer.invoke('api-key-save', key),
  /** Clear the stored API key */
  apiKeyClear: () => ipcRenderer.invoke('api-key-clear'),

  // ── AI Chat ────────────────────────────────────────────────────────────────
  /**
   * Send a prompt to DeepSeek R1 via main process.
   * @param {{ prompt: string, systemPrompt?: string, mode?: 'chat'|'quiz'|'socratic' }} args
   * @returns {Promise<{ success: boolean, response?: string, error?: string }>}
   */
  aiPromptSend: (args) => ipcRenderer.invoke('ai-prompt-send', args),

  /**
   * Streaming variant: tokens are pushed to the renderer while the model works.
   * Subscribe with onAiChunk / onAiReasoning BEFORE calling this; the promise
   * resolves with the finished response once the stream closes.
   * @param {{ prompt: string, systemPrompt?: string, mode?: string, maxTokens?: number }} args
   * @returns {Promise<{ success: boolean, response?: string, reasoning?: string, error?: string }>}
   */
  aiPromptStream: (args) => ipcRenderer.invoke('ai:stream', args),
  /**
   * Structured (JSON) generation through the staged pipeline + domain validation.
   * @param {{ messages?: object[], prompt?: string, systemPrompt?: string, mode?: string,
   *           maxTokens?: number, requiredKeys?: string[], schemaHint?: string, validate?: string }} args
   * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
   */
  aiStructured: (args) => ipcRenderer.invoke('ai:structured', args),
  /** Cancel an in-flight stream (Stop button) */
  aiAbort: (streamId) => ipcRenderer.invoke('ai:abort', { streamId }),

  // ── Unified BIA rendering for chat surfaces (Part 3) ───────────────────────
  /**
   * Reformat a finished answer into the house four-tier stylesheet. Returns raw HTML that
   * the renderer MUST pass through sanitizeBia before inserting.
   */
  aiFormatBia: (args) => ipcRenderer.invoke('ai:bia-format', args),
  /** Fired whenever a BIA artifact is produced, for listeners that prefer events. */
  onAiBia: (cb) => ipcRenderer.on('ai:response-bia', (_event, data) => cb(data)),
  /** Live answer tokens (final output) as they stream in */
  onAiChunk: (cb) => ipcRenderer.on('ai-response-chunk', (_event, data) => cb(data)),
  /** Live chain-of-thought tokens (reasoning_content) as the model thinks */
  onAiReasoning: (cb) => ipcRenderer.on('ai-response-reasoning', (_event, data) => cb(data)),
  /**
   * Pipeline stage notices. `{ stage: 'formatting', reset: true }` means the first
   * draft was replaced (truncated or off-stylesheet) and the renderer should discard
   * the text it has already typed before accepting the finished artifact.
   */
  onAiStage: (cb) => ipcRenderer.on('ai:stage', (_event, data) => cb(data)),

  // ── Model preference (R1 / DeepSeek-V3 / Gemini failover) ──────────────────
  /** Returns 'reasoner' | 'chat' | 'gemini' */
  getModelPreference: () => ipcRenderer.invoke('ai-preference-get'),
  setModelPreference: (pref) => ipcRenderer.invoke('ai-preference-set', pref),

  // ── UI preferences (theme + palette) ───────────────────────────────────────
  /** Returns { theme, background, surface, primary, text } (null = theme default) */
  getUiPreferences:    ()      => ipcRenderer.invoke('ui-preference-get'),
  /** Patch any subset of the UI preferences and persist them */
  setUiPreferences:    (prefs) => ipcRenderer.invoke('ui-preference-set', prefs),
  resetUiPreferences:  ()      => ipcRenderer.invoke('ui-preference-reset'),
  /** True when the OS is in dark mode — used for theme: 'system' */
  prefersDark: () => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return false; }
  },

  // ── Document Generation ────────────────────────────────────────────────────
  /**
   * Trigger IRAC document generation.
   * @param {{ caseText: string, caseName: string }} args
   */
  generateDocument: (args) => ipcRenderer.invoke('generate-document', args),

  // ── Boot diagnostics (main → boot.log) ──
  /** Report a genuine React mount. The only signal that proves the renderer ran. */
  rendererMounted: () => ipcRenderer.send('app:renderer-mounted'),
  /** Report an uncaught renderer error so it lands in boot.log instead of nowhere. */
  bootFault: (payload) => ipcRenderer.send('app:boot-fault', payload),
  /** Tell the main process whether an unsaved outline is open (quit guard). */
  setUnsaved: (flag) => ipcRenderer.send('app:set-unsaved', !!flag),
  /** Resolve the quit guard and exit. */
  exitNow: () => ipcRenderer.invoke('app:exit-now'),

  // ── Local Document Vault ──
  // Local-first: these work with no Supabase project, no table and no network.
  vaultSave:       (args) => ipcRenderer.invoke('vault:save', args),
  vaultList:       ()     => ipcRenderer.invoke('vault:list'),
  vaultRead:       (args) => ipcRenderer.invoke('vault:read', args),
  vaultUpdate:     (args) => ipcRenderer.invoke('vault:update', args),
  vaultDelete:     (args) => ipcRenderer.invoke('vault:delete', args),
  vaultOpenFolder: ()     => ipcRenderer.invoke('vault:open-folder'),

  // ── Export (Word / PDF / HTML / Markdown) ──
  exportDocument:  (args) => ipcRenderer.invoke('document:export', args),

  // ── Settings ───────────────────────────────────────────────────────────────
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // ── Listeners (main → renderer) ────────────────────────────────────────────
  /** Listen for main-process events (e.g., show settings modal) */
  on: (channel, callback) => {
    const allowed = ['show-settings-modal', 'ai-response-chunk', 'ai-response-done',
                     'app:unsaved-exit'];
    if (!allowed.includes(channel)) {
      console.warn(`[preload] Blocked attempt to listen on disallowed channel: ${channel}`);
      return;
    }
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },

  // ── Misc ───────────────────────────────────────────────────────────────────
  getAppVersion:       () => ipcRenderer.invoke('get-app-version'),
  openDocumentsFolder: () => ipcRenderer.invoke('open-documents-folder'),
  listRagSources:      () => ipcRenderer.invoke('list-rag-sources'),

  // ── ICM: mirror the user's own law files into an internal corpus ───────────
  /** Re-scan + re-index the mirror root (default ~/Documents/Bianna_Law) */
  icmSync:       (args)   => ipcRenderer.invoke('icm:sync', args || {}),
  /** Native folder picker → mirror + index a different root */
  icmChooseRoot: ()       => ipcRenderer.invoke('icm:choose-root'),
  /** Counts by legal discipline and document type */
  icmStats:      ()       => ipcRenderer.invoke('icm:stats'),
  /** Indexed files, newest-scanned first */
  icmList:       (args)   => ipcRenderer.invoke('icm:list', args || {}),
  /** Retrieve the student's own materials for a query */
  icmSearch:     (args)   => ipcRenderer.invoke('icm:search', args || {}),
  /** Index a single file (e.g. a freshly captured document) */
  icmIndexFile:  (filePath) => ipcRenderer.invoke('icm:index-file', { filePath }),
  /** End-to-end retrieval check: query the corpus and report matched files + block size */
  icmVerify:     (args)     => ipcRenderer.invoke('icm:verify', args || {}),
  /** Install the bundled Florida Statutes into the user's corpus (idempotent) */
  corpusEnsure:  (args)     => ipcRenderer.invoke('corpus:ensure', args || {}),
  /** Bundled vs installed statute-corpus state */
  corpusStatus:  ()         => ipcRenderer.invoke('corpus:status'),
  /** Progress events while the statute corpus is being installed */
  onCorpusInstallProgress: (cb) => {
    ipcRenderer.on('corpus:install-progress', (_event, data) => cb(data));
  },

  // ── OCR (screenshots → text, since R1 has no vision input) ────────────────
  /** Returns { available: false } when no local OCR engine is installed */
  ocrImage: (base64) => ipcRenderer.invoke('ocr:image', { base64 }),

  // ── File Picker ────────────────────────────────────────────────────────────
  pickAndReadFile: () => ipcRenderer.invoke('pick-and-read-file'),
  /**
   * Resolve the real filesystem path of a dropped/selected File (Electron ≥32), so
   * a dropped PDF can be read directly instead of re-opening a native picker.
   * Returns null when unavailable.
   */
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || null; }
    catch { return null; }
  },
  /** Extract text from a known path (.pdf / .docx / .txt / .md) */
  readFileText: (filePath, maxChars) => ipcRenderer.invoke('read-file-text', { filePath, maxChars }),

  // ── Notion Key Management ──────────────────────────────────────────────────
  notionKeyExists: ()      => ipcRenderer.invoke('notion-key-exists'),
  notionKeySave:   (key)   => ipcRenderer.invoke('notion-key-save', key),
  notionKeyClear:  ()      => ipcRenderer.invoke('notion-key-clear'),

  // ── Notion Sync ────────────────────────────────────────────────────────────
  notionSyncSummary: (args) => ipcRenderer.invoke('notion-sync-summary', args),
  notionSyncQuiz:    (args) => ipcRenderer.invoke('notion-sync-quiz', args),

  // ── Sidebar — Bianna_Law file explorer ────────────────────────────────────
  listBiannaFiles: ()         => ipcRenderer.invoke('list-bianna-files'),
  openBiannaFile:  (filePath) => ipcRenderer.invoke('open-bianna-file', filePath),

  // ── Native In-App File Preview ─────────────────────────────────────────────
  /** Preview a file inside the app without opening an external application */
  previewFile: (filePath) => ipcRenderer.invoke('preview-file', filePath),

  // ── YouTube Transcript Extraction ──────────────────────────────────────────
  extractYoutubeTranscript: (videoUrl) => ipcRenderer.invoke('extract-youtube-transcript', videoUrl),

  // ── Notion Syllabus Organizer ───────────────────────────────────────────────
  /** Extract readings from a syllabus and sync a structured dashboard to Notion */
  organizeSyllabus: (args) => ipcRenderer.invoke('organize-syllabus', args),

  // ── Persistent study memory (local Markdown files) ─────────────────────────
  /** Append a note to the local study memory (daily log or long-term facts) */
  memoryWrite: (args) => ipcRenderer.invoke('memory:write', args),
  /** Search the local study memory Markdown files */
  memorySearch: (args) => ipcRenderer.invoke('memory:search', args),

  // ── Persistent chat threads (Part 4) ────────────────────────────────────────
  /**
   * Load an action's thread, walking BACKWARD through days until a token budget is spent,
   * so a conversation from yesterday is still there this morning.
   */
  loadChatThread: (args) => ipcRenderer.invoke('ai-chat:load-thread', args),
  /** Append one turn to today's file for an action (append-only, crash-safe). */
  appendChatTurn: (args) => ipcRenderer.invoke('ai-chat:append-turn', args),
  /** Day keys holding a thread for an action, newest first. */
  listChatDays:   (args) => ipcRenderer.invoke('ai-chat:list-days', args),
  /** Search every stored conversation, scored with icm.js's own tokeniser. */
  recallChat:     (args) => ipcRenderer.invoke('ai-chat:recall', args),

  // ── Capture: chunked + staged document analysis ─────────────────────────────
  /** Analyze a document (PDF/DOCX/paste) through the staged pipeline, chunked for long inputs */
  captureAnalyze: (args) => ipcRenderer.invoke('capture:analyze', args),

  // ── Editable preset fields (custom chip values) ─────────────────────────────
  /**
   * Custom values a surface has accumulated, e.g.
   * `{ storageKey: 'outline-generator/subject' }`. Persisted in electron-store so
   * they survive restarts and are visible to the main process.
   */
  editableFieldsGet:           (args) => ipcRenderer.invoke('editable-fields:get', args),
  editableFieldsAddCustom:     (args) => ipcRenderer.invoke('editable-fields:add-custom', args),
  editableFieldsRemoveCustom:  (args) => ipcRenderer.invoke('editable-fields:remove-custom', args),
  /** Remember the current selection (surfaces whose value is free text). */
  editableFieldsSetValue:      (args) => ipcRenderer.invoke('editable-fields:set-value', args),
  /** One-shot migration of pre-1.2.0 localStorage custom values. */
  editableFieldsMigrateLegacy: (args) => ipcRenderer.invoke('editable-fields:migrate-legacy', args),

  // ── Profile & Calendar persistence ──────────────────────────────────────────
  profileGet:   ()          => ipcRenderer.invoke('profile:get'),
  profileSave:  (profile)   => ipcRenderer.invoke('profile:save', profile),
  calendarGet:  ()          => ipcRenderer.invoke('calendar:get'),
  calendarSave: (events)    => ipcRenderer.invoke('calendar:save', events),

  // ── System Diagnostics (Troubleshoot modal) ────────────────────────────────
  /** Collect full system state: API keys, corpus counts, file counts, platform info */
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  /** Open a URL in the system default browser (e.g. Google Calendar add-event link) */
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external', url),

  // ── Scan & Auto-Sort Legal Files ───────────────────────────────────────────
  /** Open a folder picker, scan for law school files, and classify them with DeepSeek R1 */
  scanLegalFiles: () => ipcRenderer.invoke('scan-legal-files'),

  // ── YouTube Playlist → Outline ─────────────────────────────────────────────
  /** Process a YouTube playlist: fetch all transcripts → DeepSeek R1 outline → save to Vault */
  processYoutubePlaylist: (args) => ipcRenderer.invoke('process-youtube-playlist', args),
  /** Subscribe to streaming progress events while a playlist is being processed */
  onPlaylistProgress: (cb) => ipcRenderer.on('playlist:progress', (_event, data) => cb(data)),
  /** Cancel an in-flight playlist run (Cancel button in Capture) */
  cancelYoutubePlaylist: () => ipcRenderer.invoke('youtube:cancel'),
  /** Fires when a pipeline saved a new document, so the Vault can refresh itself */
  onVaultNewFile: (cb) => ipcRenderer.on('document-vault:new-file', (_event, data) => cb(data)),

  // ── Native Google APIs ──────────────────────────────────────────────────────
  /** Automate adding readings to Google Calendar using the user's OAuth tokens. */
  syncGoogleCalendar: (events) => ipcRenderer.invoke('sync-google-calendar', events),
});
