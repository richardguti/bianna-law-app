/**
 * preload.js — Secure bridge between Electron main process and renderer.
 *
 * SECURITY MODEL:
 *  - contextIsolation: true  → renderer JS cannot access Node/Electron APIs directly
 *  - nodeIntegration: false  → no require() in renderer
 *  - Only explicitly whitelisted channels are exposed here via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

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
   * Send a prompt to Claude via main process.
   * @param {{ prompt: string, systemPrompt?: string, mode?: 'chat'|'quiz'|'socratic' }} args
   * @returns {Promise<{ success: boolean, response?: string, error?: string }>}
   */
  aiPromptSend: (args) => ipcRenderer.invoke('ai-prompt-send', args),

  // ── Document Generation ────────────────────────────────────────────────────
  /**
   * Trigger IRAC document generation.
   * @param {{ caseText: string, caseName: string }} args
   */
  generateDocument: (args) => ipcRenderer.invoke('generate-document', args),

  // ── Settings ───────────────────────────────────────────────────────────────
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // ── Listeners (main → renderer) ────────────────────────────────────────────
  /** Listen for main-process events (e.g., show settings modal) */
  on: (channel, callback) => {
    const allowed = ['show-settings-modal', 'ai-response-chunk', 'ai-response-done'];
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

  // ── File Picker ────────────────────────────────────────────────────────────
  pickAndReadFile: () => ipcRenderer.invoke('pick-and-read-file'),

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

  // ── OpenClaw Integration ────────────────────────────────────────────────────
  /** Check if OpenClaw CLI is installed and whether the gateway is running */
  openClawStatus:       ()     => ipcRenderer.invoke('openclaw:status'),
  /** Get the live tokenized dashboard URL — use this as the webview src */
  openClawGetDashboardUrl: () => ipcRenderer.invoke('openclaw:get-dashboard-url'),
  /** Install OpenClaw via the official PowerShell script */
  openClawInstall:      ()     => ipcRenderer.invoke('openclaw:install'),
  /** Start the OpenClaw local gateway (port 18789) */
  openClawStartGateway: ()     => ipcRenderer.invoke('openclaw:start-gateway'),
  /** Open a visible terminal window running `openclaw gateway run` — user just types y/n */
  openClawOpenTerminal: ()     => ipcRenderer.invoke('openclaw:open-terminal'),
  /** Chat via the OpenClaw gateway — includes automatic persistent memory */
  openClawChat:         (args) => ipcRenderer.invoke('openclaw:chat', args),
  /** Write a memory entry directly to OpenClaw workspace Markdown files */
  openClawMemoryWrite:  (args) => ipcRenderer.invoke('openclaw:memory-write', args),
  /** Search OpenClaw memory via the gateway tools API */
  openClawMemorySearch: (args) => ipcRenderer.invoke('openclaw:memory-search', args),
  /** Listen for streaming install progress */
  onOpenClawProgress: (cb) => {
    ipcRenderer.on('openclaw:install-progress', (_event, data) => cb(data));
  },

  // ── System Diagnostics (Troubleshoot modal) ────────────────────────────────
  /** Collect full system state: gateway status, API keys, file counts, platform info */
  getDiagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  /** Open a URL in the system default browser (e.g. Google Calendar add-event link) */
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external', url),

  // ── Scan & Auto-Sort Legal Files ───────────────────────────────────────────
  /** Open a folder picker, scan for law school files, and classify them with Claude */
  scanLegalFiles: () => ipcRenderer.invoke('scan-legal-files'),

  // ── YouTube Playlist → Outline ─────────────────────────────────────────────
  /** Process a YouTube playlist: fetch all transcripts → Claude outline → save to Vault */
  processYoutubePlaylist: (args) => ipcRenderer.invoke('process-youtube-playlist', args),
  /** Subscribe to streaming progress events while a playlist is being processed */
  onPlaylistProgress: (cb) => ipcRenderer.on('playlist:progress', (_event, data) => cb(data)),

  // ── Native Google APIs ──────────────────────────────────────────────────────
  /** Automate adding readings to Google Calendar using the user's OAuth tokens. */
  syncGoogleCalendar: (events) => ipcRenderer.invoke('sync-google-calendar', events),
});
