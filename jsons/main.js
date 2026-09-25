/**
 * main.js — Senior Law Partner
 * Electron main process: IPC handlers, DeepSeek R1 API, RAG, document generation.
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const Store  = require('electron-store');

// ─── Global Stability Guards ─────────────────────────────────────────────────
// Prevent any unhandled exception from silently crashing the app.
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  try {
    if (app.isReady()) {
      dialog.showErrorBox(
        'Senior Law Partner — Unexpected Error',
        `An error occurred but the app will keep running.\n\n${err.message}`
      );
    }
  } catch { /* dialog may not be available during very early startup */ }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason instanceof Error ? reason.message : reason);
});

// ─── Persistent Store ────────────────────────────────────────────────────────
let store;
try {
  store = new Store({ encryptionKey: 'slp-bianna-secure-2024' });
} catch (e) {
  console.error('[Store] Failed to init encrypted store, falling back to plain:', e.message);
  store = new Store();
}

// ─── RAG Module ──────────────────────────────────────────────────────────────
let getRelevantContext = () => '';
try {
  getRelevantContext = require('./rag').getRelevantContext;
} catch (e) {
  console.warn('[RAG] Failed to load rag module:', e.message);
}

// ─── Predefined Legal Skills ─────────────────────────────────────────────────
function loadSkill(filename) {
  try {
    return fs.readFileSync(path.join(__dirname, 'skills', filename), 'utf8');
  } catch {
    return '';
  }
}
const SKILL_OUTLINE_STYLE    = loadSkill('bia-outline-style.txt');
const SKILL_LAW_RESEARCH     = loadSkill('law-school-research.txt');

// ─── Notion Database IDs ─────────────────────────────────────────────────────
const NOTION_IRAC_DB = '6815ff70-de8f-46b7-910c-79f57ba612d8';
const NOTION_QUIZ_DB = 'a80f6729-fea3-479d-8e94-3c4fa43b7729';

function getNotionClient() {
  const apiKey = (store.get('notionApiKey') || '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');
  if (!apiKey) return null;
  const { Client } = require('@notionhq/client');
  return new Client({ auth: apiKey });
}

let mainWindow;

// Set inside createWindow. The renderer calls this over IPC once React has actually
// committed. `ready-to-show` cannot stand in for it: that event fires on the window's
// first paint, and backgroundColor supplies one even when the renderer bundle threw
// before React ran. See the assignment below.
let onRendererMounted = () => {};

// Quit guard. The generator can hold a 24,576-token artifact in memory, and closing the
// window used to discard it silently. The renderer reports whether anything is unsaved.
let hasUnsavedOutline = false;
let exitConfirmed      = false;

// ─── Window ──────────────────────────────────────────────────────────────────
// ─── Launch diagnostics: safe mode and failure escalation ────────────────────
// Three DMGs went out with the same white window because the failing layer was never
// named. These three values name it without requiring any UI:
//
//   SAFE_MODE     --safe-mode on argv, or SLP_SAFE_MODE=1 in the environment
//   FAILED_LAUNCHES  consecutive launches where the renderer never painted
//   SKIP_CORPUS   skip the statute install entirely
//
// Bianna cannot pass a flag from Finder, so the counter is what makes this reachable:
// two failed launches escalate the third to SKIP_CORPUS automatically. If that launch
// paints, the corpus walk is the blocker and boot.log says so. If it still does not
// paint, the fault is above the corpus install. Either way the question is answered on
// the machine that fails, with no Terminal and no setup step for the student.
//
// Assigned inside app.whenReady() because reading electron-store at module scope would
// run before the store is constructed.
let SAFE_MODE = false;
let FAILED_LAUNCHES = 0;
let SKIP_CORPUS = false;

function createWindow() {
  bootLog('createWindow start');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Senior Law Partner',
    backgroundColor: '#F8F9FA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Attach the renderer lifecycle listeners BEFORE loading, so a failure to load is
  // recorded rather than inferred. ready-to-show is the one that matters most: if it
  // never fires, the renderer never painted, and the window stays white.
  const wc = mainWindow.webContents;
  wc.on('did-finish-load', () => {
    bootLog('did-finish-load');
    // The white-screen signature: HTML loaded, but the renderer never painted. 15s is
    // safe because the corpus install is deferred and yielding, so a slow first-run
    // copy cannot hold the first paint back.
    setTimeout(() => {
      if (!readyToShowFired) {
        const next = FAILED_LAUNCHES + 1;
        try { store.set('failedLaunches', next); } catch { /* non-fatal */ }
        bootLog('WHITE_SCREEN_DETECTED: the renderer never reported a mount within 15s; ' +
                'failedLaunches -> ' + next +
                (next >= 2 ? '  (next launch will skip the corpus install)' : ''));
      }
    }, 15000);
  });
  wc.on('did-fail-load', (_e, code, desc, url) =>
    bootLog('did-fail-load: code=' + code + ' desc=' + desc + ' url=' + url));
  wc.on('render-process-gone', (_e, details) =>
    bootLog('renderer gone: ' + JSON.stringify(details)));
  wc.on('preload-error', (_e, preloadPath, err) =>
    bootLog('preload-error: ' + preloadPath + ' :: ' + (err && err.message ? err.message : err)));
  wc.on('console-message', (_e, level, message, line, source) =>
    bootLog('renderer console[' + level + '] ' + source + ':' + line + ' ' + message));
  let readyToShowFired = false;

  // An initial-paint signal, NOT a React-mount signal. Electron fires this as soon as
  // the window has anything to display, and `backgroundColor: '#F8F9FA'` is something --
  // so it fired happily on the builds whose renderer bundle threw "supabaseUrl is
  // required." before React ever ran. Any "the renderer paints" conclusion drawn from
  // this event was unfounded. The failedLaunches reset has moved to onRendererMounted;
  // this listener now only records that a paint happened.
  mainWindow.on('ready-to-show', () => {
    readyToShowFired = true;
    bootLog('ready-to-show  (window has an initial paint; this does NOT prove React mounted)');
  });

  // The honest mount signal. It arrives from an effect running inside App.tsx's provider
  // tree, so it can only fire if the whole bundle evaluated and React committed. This is
  // what clears the consecutive-failure counter, so escalation to SKIP_CORPUS is now
  // driven by a real failure rather than by a paint that a white window also produces.
  onRendererMounted = () => {
    readyToShowFired = true;
    try { store.set('failedLaunches', 0); } catch { /* non-fatal */ }
    bootLog('renderer MOUNTED  (React committed in the provider tree; failedLaunches -> 0)');
  };

  // Never let the red button discard an unsaved outline. The renderer resolves this by
  // saving, exporting, or explicitly discarding.
  mainWindow.on('close', (event) => {
    if (exitConfirmed || !hasUnsavedOutline) return;
    event.preventDefault();
    bootLog('window close intercepted: an unsaved outline is open');
    mainWindow.webContents.send('app:unsaved-exit');
  });

  const indexPath = path.join(__dirname, 'dist-react', 'index.html');
  bootLog('loadFile start: ' + indexPath + '  exists=' + fs.existsSync(indexPath));
  mainWindow.loadFile(indexPath)
    .then(() => bootLog('loadFile resolved'))
    .catch((err) => bootLog('loadFile FAILED: ' + (err && err.message ? err.message : err)));

  // DevTools: open in dev or when launched with --devtools flag
  if (!app.isPackaged || process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools();
  }
}

// ─── Boot diagnostics ────────────────────────────────────────────────────────
// The white-window failure was never tracked to a layer. Static checks proved the
// yield markers were present in the packaged main.js; they did not prove the renderer
// ever loaded. Those are different claims, and only the machine that fails can settle
// which layer breaks. This appends one timestamped line per boot step to
// userData/logs/boot.log. It must never throw: diagnostics are not allowed to become
// a fault themselves.
function bootLog(msg) {
  try {
    // A LITERAL folder name, deliberately not app.getPath('userData'). The packaged
    // package.json declares productName only under `build`, which Electron does not
    // read, so userData resolved via `name` and the first Windows harness looked in
    // %APPDATA%\Senior Law Partner and found nothing while the app was running fine.
    // Diagnostics must not depend on a value that can be spelled two ways.
    const dir = path.join(app.getPath('appData'), 'senior-law-partner-diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'boot.log'),
      new Date().toISOString() + '  ' + msg + '\n', 'utf8');
  } catch { /* never break boot for a log line */ }
}

app.whenReady().then(() => {
  bootLog('whenReady fired  electron=' + process.versions.electron +
          ' chrome=' + process.versions.chrome + ' packaged=' + app.isPackaged);

  // Safe mode and escalation. Wrapped because a store failure must never block boot.
  try {
    SAFE_MODE = process.argv.includes('--safe-mode') || process.env.SLP_SAFE_MODE === '1';
    FAILED_LAUNCHES = Number(store.get('failedLaunches', 0)) || 0;
  } catch (err) {
    bootLog('diagnostics init failed (continuing normally): ' + err.message);
  }
  SKIP_CORPUS = SAFE_MODE || FAILED_LAUNCHES >= 2;
  bootLog('diagnostics: safe_mode=' + SAFE_MODE + ' failed_launches=' + FAILED_LAUNCHES +
          ' skip_corpus=' + SKIP_CORPUS + (FAILED_LAUNCHES >= 2 ? '  (ESCALATED after 2 failed launches)' : ''));
  try { ensureBiannaLawDir(); } catch (e) { console.warn('[fs] Could not create Bianna_Law dir:', e.message); }
  createWindow();

  // First launch: copy the bundled Florida Statutes into her corpus, then index it.
  // Runs after the window exists so corpus:install-progress has somewhere to land.
  // Deferred via setImmediate AND left unawaited: the install walks ~24,670 entries
  // through the asar index, and any of that work landing on the boot path blocks the
  // event loop before the renderer's loadFile completes -- which is a white window.
  // Belt and braces: the function also yields before doing anything at all.
  if (SKIP_CORPUS) {
    bootLog('corpus install SKIPPED  safe_mode=' + SAFE_MODE + ' escalated=' + (FAILED_LAUNCHES >= 2));
  } else {
  setImmediate(() => {
    bootLog('corpus setImmediate fired (renderer should be past loadFile by now)');
    ensureStatuteCorpusInstalled()
      .then((res) => {
        bootLog('corpus install done: ' + JSON.stringify(res));
        if (res && res.ok && !res.skipped && res.installed) syncIcmAfterCorpusInstall();
      })
      .catch((err) => {
        bootLog('corpus install threw: ' + (err && err.message ? err.message : err));
        console.warn('[corpus] startup install skipped:', err.message);
      });
  });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('[App] whenReady failed:', err);
  dialog.showErrorBox('Senior Law Partner — Startup Error', err.message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── File System: Documents/Bianna_Law/ ──────────────────────────────────────
function getBiannaLawDir() {
  // app.getPath('documents') resolves the OS Documents folder (Windows may
  // redirect it to a cloud-synced location). That is where the corpus actually
  // lives, so resolve it fresh rather than guessing at a local path.
  return path.join(app.getPath('documents'), 'Bianna_Law');
}

function ensureBiannaLawDir() {
  const dir = getBiannaLawDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('[fs] Created Bianna_Law directory:', dir);
  }
}

// ─── Statute reference corpus: bundle → first-launch install ─────────────────
// The full Florida Statutes ship inside the app (app.asar.unpacked/references/
// florida-statutes) and are copied once into the user's own corpus so ICM indexes
// them alongside her course materials, labelled florida_statutes/statute.
const STATUTE_VERSION = '2025.2-fl26';
let _corpusLastInstall = null;

function statuteInstallDir() {
  return path.join(getBiannaLawDir(), 'references', 'florida-statutes');
}

function bundledStatuteDir() {
  const candidates = [
    // Inside the archive. The corpus used to ship unpacked, but 24,671 loose files
    // in app.asar.unpacked made @electron/osx-sign exhaust file descriptors while
    // signing (EMFILE, even with ulimit -n 65535 -- the usage there is unbounded,
    // not merely above the default 256). Electron's fs shim reads and walks asar
    // paths transparently, so keeping the corpus packed removes that walk entirely.
    // The unpacked candidates stay as fallbacks for any older staged build tree.
    path.join(app.getAppPath(), 'references', 'florida-statutes'),
    `${app.getAppPath()}.unpacked/references/florida-statutes`,
    path.join(path.dirname(app.getAppPath()), 'app.asar.unpacked', 'references', 'florida-statutes'),
    path.join(__dirname, '..', 'icm', 'references', 'florida-statutes'), // dev tree
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* try next */ }
  }
  return null;
}

function readStatuteVersion(dir) {
  try { return fs.readFileSync(path.join(dir, '.version'), 'utf8').trim(); } catch { return null; }
}

function countMarkdown(dir) {
  let n = 0;
  try {
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) n++;
      }
    })(dir);
  } catch { /* missing dir */ }
  return n;
}

function corpusProgress(done, total) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('corpus:install-progress', { done, total });
  }
}

/**
 * Idempotent first-launch install. Compares .version markers and copies only what
 * is missing or differs in size. Never throws — a failure must not block app start.
 */
async function ensureStatuteCorpusInstalled({ force = false } = {}) {
  // Yield before any synchronous work. Reading entries out of an asar is a lookup in
  // the archive's metadata tree, not a filesystem read, so the walk below is far
  // slower than it looks. Without this, no caller can help but block the event loop.
  await new Promise((r) => setImmediate(r));
  try {
    const src = bundledStatuteDir();
    if (!src) return { ok: false, reason: 'no bundled corpus' };

    const dest = statuteInstallDir();
    const srcVersion = readStatuteVersion(src) || STATUTE_VERSION;
    if (!force && readStatuteVersion(dest) === srcVersion) {
      return { ok: true, skipped: true, version: srcVersion, dest, files: countMarkdown(dest) };
    }

    const files = [];
    let seen = 0;
    // Yielding walk. This is the actual blocking site: it enumerates ~24,670 entries
    // through the asar index before anything else runs, and while it was a synchronous
    // IIFE the event loop could not serve the renderer's loadFile -- the app opened to
    // a white window. 25 per yield keeps the UI responsive; a setImmediate that often
    // costs nothing measurable.
    async function collect(dir, rel) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const s = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await collect(s, r);
        else if (e.name !== '.version') files.push({ s, r });
        if (++seen % 25 === 0) await new Promise((r2) => setImmediate(r2));
      }
    }
    await collect(src, '');

    const total = files.length;
    let done = 0, copied = 0;
    const started = Date.now();
    for (const { s, r } of files) {
      const d = path.join(dest, r);
      try {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        if (force || !fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(s).size) {
          fs.copyFileSync(s, d);
          copied++;
        }
      } catch { /* skip unreadable entry rather than abort the install */ }
      done++;
      // Yield often. Asar entry lookups are slower than filesystem reads, and the
      // copy touches ~24,670 of them; 25 per breath keeps progress repaints alive.
      if (done % 25 === 0) {
        corpusProgress(done, total);
        await new Promise((r2) => setImmediate(r2));
      }
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, '.version'), srcVersion, 'utf8');
    corpusProgress(total, total);

    const ms = Date.now() - started;
    _corpusLastInstall = { copied, total, ms, version: srcVersion, at: new Date().toISOString() };
    console.log(`[corpus] installed ${copied}/${total} statute files in ${ms}ms -> ${dest}`);
    return { ok: true, installed: copied, total, ms, version: srcVersion, dest };
  } catch (err) {
    console.warn('[corpus] install skipped:', err.message);
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('corpus:ensure', async (_event, args) => ensureStatuteCorpusInstalled(args || {}));

ipcMain.handle('corpus:status', () => {
  const src = bundledStatuteDir();
  const dest = statuteInstallDir();
  return {
    bundled: src,
    bundledVersion: src ? readStatuteVersion(src) : null,
    bundledFiles: src ? countMarkdown(src) : 0,
    installed: dest,
    installedVersion: readStatuteVersion(dest),
    installedFiles: countMarkdown(dest),
    expectedVersion: STATUTE_VERSION,
    lastInstall: _corpusLastInstall,
  };
});

/** Index the freshly-installed corpus in the background. */
async function syncIcmAfterCorpusInstall() {
  const icm = getIcm();
  if (!icm) return;
  try {
    const r = await icm.sync(getBiannaLawDir());
    console.log(`[ICM] post-install sync: ${r.indexed} files indexed`);
  } catch (err) {
    console.warn('[ICM] post-install sync failed:', err.message);
  }
}

// ─── DeepSeek & API Key Management ───────────────────────────────────────────
// The key is NOT in source. The renderer's injected default (VITE_DEEPSEEK_KEY from
// a gitignored .env.local locally, or the DEEPSEEK_KEY repository secret in CI)
// travels with each IPC call, and the student's own saved key is preferred below.
// This constant is the last-resort fallback for a key supplied in the environment;
// when it is empty, getDeepSeekKey() returns the stored key or nothing, and Settings
// is where a student supplies her own. No credential belongs in the repository.
const DEFAULT_DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function getDeepSeekKey() {
  return (store.get('deepseekApiKey') || store.get('anthropicApiKey') || DEFAULT_DEEPSEEK_KEY).trim();
}

async function callDeepSeekMain({ apiKey, messages, model = 'deepseek-reasoner', maxTokens = 8192 }) {
  const key = apiKey || getDeepSeekKey();

  // DeepSeek R1 (deepseek-reasoner) emits an internal chain-of-thought in
  // `reasoning_content` before writing the final `content`. On some prompts the
  // reasoning pass consumes the entire output budget and the turn returns with
  // empty `content` (finish_reason: 'length'). Retry once with an escalated
  // budget, then salvage the tail of the reasoning trace so callers always get
  // usable text instead of a hard failure.
  const budgets = [maxTokens, Math.min(maxTokens * 2, 32768)];
  let lastReasoning = '';

  for (const budget of budgets) {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: budget,
      }),
    });

    if (!res.ok) {
      let errMsg = `DeepSeek API HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch { /* empty */ }
      throw new Error(errMsg);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    if (choice && choice.content) return choice.content;
    lastReasoning = choice?.reasoning_content || lastReasoning;
  }

  // Reasoning-only turn — salvage the closing portion of the CoT trace.
  const trace = lastReasoning.trim();
  if (trace) return trace.length > 12000 ? trace.slice(-12000) : trace;

  throw new Error('Empty response from DeepSeek API.');
}

/**
 * Streaming variant of callDeepSeekMain.
 *
 * DeepSeek R1 turns regularly take 30–90s. Rather than making the renderer wait
 * on a silent request, this consumes the SSE stream and reports deltas as they
 * arrive so the UI can type out the answer live — and, crucially, show the
 * model's `reasoning_content` chain-of-thought while it thinks.
 *
 * Returns the full assembled { content, reasoning } once the stream closes.
 */
async function streamDeepSeekMain({
  apiKey,
  messages,
  model = 'deepseek-reasoner',
  maxTokens = 16384,
  onReasoning,
  onContent,
  signal,
} = {}) {
  const key = apiKey || getDeepSeekKey();

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
    signal,
  });

  if (!res.ok) {
    let errMsg = `DeepSeek API HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errMsg = errJson.error?.message || errMsg;
    } catch { /* empty */ }
    throw new Error(errMsg);
  }
  if (!res.body) throw new Error('DeepSeek API returned no stream body.');

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf8');
  let buffer    = '';
  let content   = '';
  let reasoning = '';
  let finishReason = '';

  // SSE frames are "data: {json}\n\n"; tolerate partial frames across chunks.
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let json;
    try { json = JSON.parse(payload); } catch { return; }
    // finish_reason rides the final frame, which may carry no delta at all — read it
    // before the delta guard or it is dropped and truncation becomes invisible.
    const fr = json.choices?.[0]?.finish_reason;
    if (fr) finishReason = fr;
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      if (onReasoning) onReasoning(delta.reasoning_content);
    }
    if (delta.content) {
      content += delta.content;
      if (onContent) onContent(delta.content);
    }
  };

  for (;;) {
    let read;
    try {
      read = await reader.read();
    } catch (readErr) {
      // A Stop press aborts the reader mid-stream — keep whatever arrived.
      if (readErr && (readErr.name === 'AbortError' || /abort/i.test(readErr.message || ''))) break;
      throw readErr;
    }
    const { done, value } = read;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer) handleLine(buffer);

  return { content, reasoning, aborted: !!(signal && signal.aborted), finishReason };
}

ipcMain.handle('api-key-exists', () => !!(getDeepSeekKey()));

ipcMain.handle('api-key-save', (_event, key) => {
  if (!key || typeof key !== 'string' || !key.startsWith('sk-')) {
    return { success: false, error: 'Invalid API key format. Key must start with "sk-".' };
  }
  store.set('deepseekApiKey', key.trim());
  store.set('anthropicApiKey', key.trim());
  return { success: true };
});

ipcMain.handle('api-key-clear', () => {
  store.delete('deepseekApiKey');
  store.delete('anthropicApiKey');
  return { success: true };
});

// ─── ICM: the student's own materials as an internal RAG corpus ───────────────
// icm.js is lazy-required so a missing/broken module degrades to "no ICM context"
// instead of taking down app startup.
let _icm = null;
function getIcm() {
  if (_icm === null) {
    try { _icm = require('./icm'); }
    catch (err) { console.warn('[ICM] unavailable:', err.message); _icm = false; }
  }
  return _icm || null;
}

/** Grounding block built from the student's own mirrored files ('' when empty). */
function getIcmContext(query, topK = 4) {
  const icm = getIcm();
  if (!icm || !query) return '';
  try { return icm.getIcmContext(query, topK); }
  catch (err) { console.warn('[ICM] context failed:', err.message); return ''; }
}

ipcMain.handle('icm:sync', async (_event, { root } = {}) => {
  const icm = getIcm();
  if (!icm) return { success: false, error: 'ICM module unavailable.' };
  try {
    // Default to the same corpus dir the rest of the app reads (getBiannaLawDir),
    // NOT icm.APP_DIR — the latter resolves to a local Documents path that does
    // not contain the actual course files when Windows redirects Documents.
    const target = root || getBiannaLawDir();
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    const result = await icm.sync(target);
    return { success: true, ...result, stats: icm.stats() };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('icm:choose-root', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the folder to mirror into your study corpus',
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths.length) return { canceled: true };
  const icm = getIcm();
  if (!icm) return { success: false, error: 'ICM module unavailable.' };
  try {
    const result = await icm.sync(filePaths[0]);
    return { success: true, ...result, stats: icm.stats() };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('icm:stats', () => {
  const icm = getIcm();
  if (!icm) return { files: 0, byDiscipline: {}, byDocType: {}, unavailable: true };
  return icm.stats();
});

ipcMain.handle('icm:list', (_event, { limit } = {}) => {
  const icm = getIcm();
  return icm ? icm.listEntries(limit || 200) : [];
});

ipcMain.handle('icm:search', (_event, { query, topK } = {}) => {
  const icm = getIcm();
  return icm ? icm.search(query || '', topK || 8) : [];
});

ipcMain.handle('icm:index-file', async (_event, { filePath } = {}) => {
  const icm = getIcm();
  if (!icm || !filePath) return { success: false, error: 'No file supplied.' };
  try { return { success: true, entry: await icm.upsert(filePath) }; }
  catch (err) { return { success: false, error: err.message }; }
});

// Verify the ICM pipeline end-to-end: given a test query, return which indexed
// files matched, the size of the injected block, and where it sits in the prompt.
ipcMain.handle('icm:verify', (_event, { query = 'minimum contacts' } = {}) => {
  const icm = getIcm();
  if (!icm) return { success: false, error: 'ICM module unavailable.' };

  const stats = icm.stats();
  const hits = icm.search(query, 4);
  const block = icm.getIcmContext(query, 4);

  return {
    success: true,
    query,
    filesIndexed: stats.files,
    byDiscipline: stats.byDiscipline,
    byDocType: stats.byDocType,
    matched: hits.map((h) => ({ rel: h.rel, discipline: h.discipline, docType: h.docType, score: h.score })),
    injectedBlockLength: block ? block.length : 0,
    injectedBlockPrefix: block ? block.slice(0, 120) : '',
    blockOrderedBeforeRag: true, // buildGroundingSuffix emits ICM before the generic RAG block
  };
});

// ─── IPC: Image OCR ──────────────────────────────────────────────────────────
// DeepSeek R1 has no vision input, so a screenshot of a casebook page is converted
// to text first. This uses an OCR engine ONLY if one is installed locally — the app
// is offline-first, so nothing is downloaded — and otherwise reports that it is
// unavailable so the UI can offer paste-text capture instead.
ipcMain.handle('ocr:image', async (_event, { base64 } = {}) => {
  if (!base64) return { success: false, available: false, error: 'No image data supplied.' };
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(Buffer.from(base64, 'base64'));
      const text = (data && data.text ? data.text : '').trim();
      return { success: !!text, available: true, text };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    return {
      success: false,
      available: false,
      error: `No local OCR engine available (${err.code || err.message}).`,
    };
  }
});


// ─── AI Tools — Lazy Initialization ──────────────────────────────────────────
// Modules are required on first use instead of at startup so that any import
// failure is isolated to the specific feature, not the entire app launch.
const GEMINI_API_KEY = 'AIzaSyCuld2555PxD65YVIcTVJNPwKdXYVTKJrE';

let _genAI = null;
function getGenAI() {
  if (_genAI) return _genAI;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    _genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  } catch (e) {
    console.warn('[Gemini] Init failed:', e.message);
  }
  return _genAI;
}

let _supermemory = null;
function getSupermemory() {
  if (_supermemory) return _supermemory;
  try {
    const { Supermemory } = require('supermemory');
    const smKey = store.get('supermemoryApiKey') || 'dummy-key-for-now';
    _supermemory = new Supermemory({ apiKey: smKey });
  } catch (e) {
    console.warn('[Supermemory] Init failed:', e.message);
  }
  return _supermemory;
}

// ─── Part 3: unified BIA rendering for chat surfaces ─────────────────────────
/**
 * Chat answers render in the same four-tier house language as outlines.
 *
 * LAZY on purpose. This composes OUTLINE_STYLE_CONTRACT, which is declared later in this
 * file; building the string eagerly at module load threw a temporal-dead-zone
 * ReferenceError and killed main.js before any IPC handler after this point was
 * registered. Every packaged gate then reported "No handler registered" while the renderer
 * - a separate bundle - worked perfectly, which is what made it look like a stale process.
 *
 * Built on OUTLINE_STYLE_CONTRACT rather than a second copy of the tier definitions: that
 * contract is the wording measured to actually hold (BIA_SYSTEM merely *describes* the
 * tiers, and both models ignored it), so chat inherits the version that works.
 */
let _biaSystemChat = null;
function biaSystemChat() {
  if (_biaSystemChat === null) {
    _biaSystemChat = `${OUTLINE_STYLE_CONTRACT}

---
CHAT MODE ADDENDUM:
The user is asking a question, requesting a plan, or requesting a drill - not requesting a
full outline.

Rules:
- Still use the four-tier HTML structure for any doctrinal content.
- For non-doctrinal responses (schedules, checklists, comparisons), map natural structure
  onto the tiers:
    Tier 1 = title
    Tier 2 = major section ("Day 1", "Assumptions", "Scope")
    Tier 3 = sub-item ("Block 1: Read", "A. Scope")
    Tier 4 = rule text or detail
- Tables are forbidden. Convert every table into Tier 3 rows.
- Horizontal rules are forbidden. Use Tier 2 separation instead.
- Every visible element must be inside the four-tier system.
- Case names use <em><strong>Case Name</strong></em>.
- Statutes cite as Fla. Stat. § 732.102 inside Tier 4 text.
- Output raw HTML only. No markdown. No \`\`\` fences. No preamble.
`;
  }
  return _biaSystemChat;
}

/**
 * Reformat an arbitrary answer into the house stylesheet.
 *
 * Runs on the format-stable chat model rather than the reasoner: this is a formatting job,
 * and formatting is the one thing the chat model is reliably good at - the same split the
 * outline pipeline uses.
 */
async function formatAsBia({ apiKey, rawText, mode = 'chat' }) {
  if (!rawText || !String(rawText).trim()) return '';
  return callDeepSeekMain({
    apiKey: apiKey || getDeepSeekKey(),
    model: MODEL_IDS.chat,
    maxTokens: 16384,
    messages: [
      { role: 'system', content: mode === 'chat' ? biaSystemChat() : OUTLINE_STYLE_CONTRACT },
      { role: 'user', content: String(rawText) },
    ],
  });
}

/**
 * IPC: reformat text into the house stylesheet.
 *
 * Deliberately a separate call rather than a flag on ai:stream. The outline streaming path
 * has a passing 8/8 packaged gate against it, and this way that path stays byte-identical;
 * a chat surface streams its readable answer, then swaps in this finished artifact.
 */
ipcMain.handle('ai:bia-format', async (_event, { text, mode = 'chat' } = {}) => {
  const apiKey = getDeepSeekKey();
  if (!text || !String(text).trim()) return { success: false, error: 'No text to format.' };
  try {
    const biaHtml = await formatAsBia({ apiKey, rawText: text, mode });
    if (!biaHtml.trim()) return { success: false, error: 'The formatter returned nothing.' };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai:response-bia', { html: biaHtml, mode });
    }
    return { success: true, biaHtml };
  } catch (err) {
    console.error('[ai:bia-format]', err);
    return { success: false, error: err.message || 'Formatting failed.' };
  }
});

// ─── IPC: AI Chat (Dual Model + Supermemory + RAG) ─────────────────────────
ipcMain.handle('ai-prompt-send', async (_event, { prompt, systemPrompt, mode, modelPreference, bia = false } = {}) => {
  const apiKey = getDeepSeekKey();

  try {
    // Prefer an explicit request-level preference, else the stored Settings choice.
    const pref = (modelPreference && (MODEL_IDS[modelPreference] || modelPreference === 'gemini'))
      ? modelPreference
      : getModelPreference();

    const fullSystem = await buildGroundingBlocks(prompt, mode, systemPrompt);

    let responseText = '';

    if (resolveModelId(pref) === 'gemini') {
      const gemini = getGenAI();
      if (!gemini) throw new Error('Gemini AI not available. Check your API key.');
      const model = gemini.getGenerativeModel({ model: 'gemini-1.5-pro', systemInstruction: fullSystem });
      const result = await model.generateContent(prompt);
      responseText = result.response.text();
    } else {
      const messages = [
        { role: 'system', content: fullSystem },
        { role: 'user', content: prompt },
      ];
      responseText = await callDeepSeekMain({
        apiKey,
        messages,
        model: resolveModelId(pref),
        maxTokens: 8192,
      });
    }

    // Part 3: render chat answers in the same four-tier language as outlines. Opt-in, so
    // only surfaces that ask for it pay the extra formatting call.
    if (bia && responseText.trim()) {
      try {
        const biaHtml = await formatAsBia({ apiKey, rawText: responseText, mode: 'chat' });
        if (biaHtml.trim()) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai:response-bia', { html: biaHtml, mode });
          }
          return { success: true, response: biaHtml, biaHtml, raw: responseText };
        }
      } catch (biaErr) {
        // A formatting outage must never cost her the answer.
        console.error('[AI Chat] bia formatting failed:', biaErr.message);
      }
    }

    return { success: true, response: responseText };
  } catch (err) {
    console.error('[AI Chat]', err);
    return { success: false, error: err.message || 'Unknown error calling AI API.' };
  }
});

// ─── IPC: Streaming AI prompt (live tokens + reasoning trace) ────────────────
// In-flight streams, keyed by streamId, so the renderer's Stop button can abort
// the SSE connection mid-flight.
const activeStreams = new Map();
// Emits 'ai-response-reasoning' and 'ai-response-chunk' while the model works, so
// the renderer can show the answer forming instead of a 90-second static spinner.
// The invoke() still resolves with the finished text, so callers keep the simple
// request/response contract they already have.
ipcMain.handle('ai:stream', async (event, { prompt, systemPrompt, messages, mode, modelPreference, maxTokens = 16384, streamId, formatStrict = false } = {}) => {
  const apiKey = getDeepSeekKey();
  const id = streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  activeStreams.set(id, controller);

  const send = (channel, payload) => {
    try {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    } catch { /* window closed mid-stream */ }
  };

  try {
    const pref = (modelPreference && MODEL_IDS[modelPreference]) ? modelPreference : getModelPreference();
    const chatMessages = await composeMessages({ prompt, systemPrompt, mode, messages });

    const { content, reasoning, aborted, finishReason } = await streamDeepSeekMain({
      apiKey,
      model: resolveModelId(pref),
      maxTokens,
      messages: chatMessages,
      signal: controller.signal,
      onReasoning: (delta) => send('ai-response-reasoning', { delta, streamId: id }),
      onContent:   (delta) => send('ai-response-chunk', { delta, streamId: id }),
    });

    // Stopped by the user — hand back what arrived so the UI keeps the partial text.
    if (aborted) {
      return { success: true, response: content, reasoning, aborted: true, streamId: id };
    }

    // Two-stage fallback: R1 thought it through but did not emit an artifact.
    if (!content.trim() && reasoning.trim()) {
      send('ai:stage', { stage: 'formatting' });
      const formatted = await formatWithChat({
        apiKey,
        rawReasoning: reasoning,
        instruction: buildDefaultSystem(mode),
      });
      if (formatted.trim()) {
        send('ai-response-chunk', { delta: formatted });
        return { success: true, response: formatted, reasoning, usedFormatter: true };
      }
    }

    if (!content.trim()) {
      return { success: false, error: 'DeepSeek returned an empty answer. Try again or switch models in Settings.' };
    }

    // Truncation: R1 hit the output ceiling mid-document. This is NOT the empty case —
    // the draft is tens of thousands of usable characters — so every guard above passes
    // it straight through and a document cut off mid-tag used to reach the renderer
    // untouched.
    //
    // Recovery is two bounded steps:
    //   1. ONE continuation call: R1 resumes where it stopped and the text is appended.
    //      Deliberately not a loop — each reasoner call is 60-90s, and three retries
    //      would be 4.5 minutes of spinner before she sees a finished outline. One
    //      retry catches the overwhelming majority of cases.
    //   2. The formatting stage, which renders the house stylesheet and closes anything
    //      still dangling, marking the truncation inline if step 1 did not finish it.
    let draft = content;
    let continued = false;

    if (finishReason === 'length') {
      send('ai:stage', { stage: 'continuing' });
      try {
        const tail = draft.slice(-2000);
        const next = await streamDeepSeekMain({
          apiKey,
          model: resolveModelId(pref),
          maxTokens,
          messages: [
            ...chatMessages,
            { role: 'assistant', content: draft },
            {
              role: 'user',
              content: `Continue exactly where you left off. Do not repeat any prior text. The previous response ended with: "${tail}"`,
            },
          ],
          signal: controller.signal,
          // Same channel as the first pass: the live view keeps growing rather than
          // resetting, so the continuation reads as the outline writing itself out.
          onContent: (delta) => send('ai-response-chunk', { delta, streamId: id }),
        });
        if (next.content.trim() && !next.aborted) {
          draft += next.content;
          continued = true;
        }
      } catch (contErr) {
        // Losing the continuation is survivable — the formatter can still close the draft.
        console.error('[AI Stream] continuation failed:', contErr.message);
      }
    }

    // formatStrict marks output that must match the house stylesheet (the Outline
    // Generator sets it). Those runs always go through the formatter, because R1
    // ignores the tier styles on its own; a truncated run is formatted whether or not it
    // was strict, since closing a half-written document is right in either case.
    // `reset: true` tells the UI to discard what it already typed, so the live view
    // shows the finished artifact rather than the dead draft followed by a second copy.
    if (formatStrict || finishReason === 'length') {
      send('ai:stage', { stage: 'formatting', reset: true });
      try {
        const completed = await completeWithChat({
          apiKey,
          draft,
          instruction: formatStrict ? OUTLINE_STYLE_CONTRACT : buildDefaultSystem(mode),
        });
        if (completed.trim()) {
          send('ai-response-chunk', { delta: completed, streamId: id });
          return { success: true, response: completed, reasoning, usedFormatter: true, continued, truncated: finishReason === 'length' };
        }
      } catch (fmtErr) {
        // A formatter outage must never cost her the draft she already has.
        console.error('[AI Stream] formatting stage failed:', fmtErr.message);
      }
    }

    return { success: true, response: draft, reasoning, streamId: id, continued, truncated: finishReason === 'length' };
  } catch (err) {
    // A Stop press can also abort the initial fetch, before any bytes arrive.
    if (err && (err.name === 'AbortError' || /abort/i.test(err.message || ''))) {
      return { success: true, response: '', reasoning: '', aborted: true, streamId: id };
    }
    console.error('[AI Stream]', err);
    return { success: false, error: err.message || 'Unknown error calling DeepSeek API.' };
  } finally {
    activeStreams.delete(id);
  }
});

// ─── IPC: Abort an in-flight stream (Stop button) ────────────────────────────
ipcMain.handle('ai:abort', (_event, { streamId } = {}) => {
  const controller = streamId ? activeStreams.get(streamId) : null;
  if (controller) {
    controller.abort();
    return { success: true, streamId };
  }
  // No id supplied: stop whatever is currently streaming (single-window app).
  const next = activeStreams.entries().next();
  if (!next.done) {
    const [id, ctrl] = next.value;
    ctrl.abort();
    return { success: true, streamId: id };
  }
  return { success: false, error: 'No stream was in flight.' };
});

function buildDefaultSystem(mode) {
  const base = `You are a Senior Law Partner and AI mentor to Bianna, a 1L law student.

You embody the intersection of elite legal expertise and AI capabilities. Your core skill set:
- ANALYZING: Break down complex legal problems using structured frameworks; identify the precise legal issue in every fact pattern.
- RESEARCHING: Draw on case law, FRCP rules, constitutional provisions, and statutes to support every answer with authority.
- SUMMARIZING: Distill dense legal material — cases, statutes, transcripts — into clear, scannable, actionable insights.
- DRAFTING: Produce precise IRAC-structured arguments, case briefs, and outlines. Every analysis follows Issue → Rule → Application → Conclusion.
- EXTRACTING INFORMATION: Pull out material facts, holdings, rules, and policy rationale from any source Bianna provides.
- REVIEWING: Critically evaluate Bianna's reasoning. Correct mistakes firmly but encouragingly. Explain why she was wrong and what the correct analysis is.
- TASKS DONE AT SCALE: Handle multi-issue problems, full case analyses, entire transcript reviews, and complex statutory interpretation efficiently.

Use the Socratic method by default: ask probing questions, guide her reasoning, and let her arrive at conclusions herself before confirming.
Always be precise with legal terminology. Cite cases and statutes where relevant.`;

  // Inject predefined skills
  const skillsBlock = [SKILL_LAW_RESEARCH, SKILL_OUTLINE_STYLE]
    .filter(Boolean)
    .map(s => `\n\n---\n${s}`)
    .join('');

  if (mode === 'quiz') {
    return base + skillsBlock + '\n\nMode: QUIZ. Generate challenging exam-style questions for a 1L. After each answer, give detailed feedback on correctness and the model answer.';
  }
  if (mode === 'grade') {
    return base + '\n\nMode: GRADE. You are grading a single quiz answer. Respond ONLY with a valid JSON object (no markdown fences): {"correct": true|false, "score": 1|0, "feedback": "brief explanation of why", "model_answer": "the ideal answer in 2-3 sentences"}';
  }
  if (mode === 'socratic') {
    return base + skillsBlock + '\n\nMode: SOCRATIC. Do not give direct answers. Guide Bianna to the correct conclusion through targeted questions only.';
  }
  if (mode === 'outline') {
    return base + skillsBlock + '\n\nMode: OUTLINE. You MUST format all output using the bia-outline-style rules above. No flowing paragraphs — strict numbered/lettered hierarchical outline only.';
  }
  return base + skillsBlock;
}

// ─── Model preference (reasoner ⇄ chat ⇄ Gemini failover) ────────────────────
// DeepSeek's API has suffered congestion outages; the Settings tab lets Bianna
// switch the answering model without touching code.
const MODEL_PREF_KEY = 'aiModelPreference';   // 'reasoner' | 'chat' | 'gemini'
const MODEL_IDS = {
  reasoner: 'deepseek-reasoner',  // R1 — deepest reasoning (default)
  chat:     'deepseek-chat',      // V3 — fast, strong formatting
};

function getModelPreference() {
  const pref = store.get(MODEL_PREF_KEY);
  return MODEL_IDS[pref] ? pref : 'reasoner';
}

function resolveModelId(pref) {
  if (pref === 'gemini') return 'gemini';
  return MODEL_IDS[pref] || MODEL_IDS.reasoner;
}

ipcMain.handle('ai-preference-get', () => getModelPreference());
ipcMain.handle('ai-preference-set', (_event, pref) => {
  if (!MODEL_IDS[pref] && pref !== 'gemini') {
    return { success: false, error: `Unknown model preference: ${pref}` };
  }
  store.set(MODEL_PREF_KEY, pref);
  return { success: true, preference: pref };
});

// ─── UI preferences (theme + palette) ────────────────────────────────────────
// `null` means "use the theme default", so switching light/dark stays coherent
// while any colour the user explicitly picks is preserved.
const UI_PREF_KEY = 'uiPreferences';
const DEFAULT_UI_PREFS = {
  theme: 'system',        // 'light' | 'dark' | 'system'
  background: null,       // hex string when customised
  surface: null,
  primary: null,
  text: null,
};

// ─── IPC: Editable preset fields (custom chip values, Part 5) ────────────────
// Every preset field's custom values are namespaced under one store key, so a typo in
// a page's storageKey cannot silently create a second, invisible list, and one migration
// covers all six surfaces.
const EDITABLE_FIELDS_KEY = 'editableFields';

function readEditableField(storageKey) {
  const all = store.get(EDITABLE_FIELDS_KEY, {}) || {};
  const rec = all[storageKey] || {};
  return {
    customValues: Array.isArray(rec.customValues) ? rec.customValues : [],
    value: typeof rec.value === 'string' ? rec.value : undefined,
  };
}

function writeEditableField(storageKey, patch) {
  const all = store.get(EDITABLE_FIELDS_KEY, {}) || {};
  all[storageKey] = { ...readEditableField(storageKey), ...patch };
  store.set(EDITABLE_FIELDS_KEY, all);
  return all[storageKey];
}

ipcMain.handle('editable-fields:get', (_event, { storageKey } = {}) => {
  if (!storageKey) return { success: false, customValues: [], error: 'storageKey required' };
  return { success: true, ...readEditableField(storageKey) };
});

ipcMain.handle('editable-fields:add-custom', (_event, { storageKey, value } = {}) => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!storageKey || !v) return { success: false, customValues: [], error: 'storageKey and value required' };
  const rec = readEditableField(storageKey);
  const exists = rec.customValues.some((c) => c.toLowerCase() === v.toLowerCase());
  // Case-insensitive: adding "admiralty law" must not create a second chip beside
  // "Admiralty Law".
  const customValues = exists ? rec.customValues : [...rec.customValues, v];
  writeEditableField(storageKey, { customValues });
  return { success: true, customValues };
});

ipcMain.handle('editable-fields:remove-custom', (_event, { storageKey, value } = {}) => {
  if (!storageKey) return { success: false, customValues: [], error: 'storageKey required' };
  const rec = readEditableField(storageKey);
  const drop = String(value || '').toLowerCase();
  const customValues = rec.customValues.filter((c) => c.toLowerCase() !== drop);
  writeEditableField(storageKey, { customValues });
  return { success: true, customValues };
});

ipcMain.handle('editable-fields:set-value', (_event, { storageKey, value } = {}) => {
  if (!storageKey) return { success: false, error: 'storageKey required' };
  writeEditableField(storageKey, { value: typeof value === 'string' ? value : '' });
  return { success: true };
});

/**
 * One-shot migration: pre-1.2.0 kept a typed custom subject in the renderer's
 * localStorage, where the main process could not see it. The renderer hands those
 * values over here and only clears its legacy key once this reports success, so a
 * failed migration loses nothing.
 */
ipcMain.handle('editable-fields:migrate-legacy', (_event, { storageKey, values } = {}) => {
  if (!storageKey || !Array.isArray(values)) {
    return { success: false, customValues: [], migrated: 0, error: 'storageKey and values required' };
  }
  const rec = readEditableField(storageKey);
  const customValues = [...rec.customValues];
  let migrated = 0;
  for (const raw of values) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v || customValues.some((c) => c.toLowerCase() === v.toLowerCase())) continue;
    customValues.push(v);
    migrated++;
  }
  if (migrated) writeEditableField(storageKey, { customValues });
  return { success: true, customValues, migrated };
});

ipcMain.handle('ui-preference-get', () => ({ ...DEFAULT_UI_PREFS, ...(store.get(UI_PREF_KEY) || {}) }));

ipcMain.handle('ui-preference-set', (_event, prefs = {}) => {
  const merged = { ...DEFAULT_UI_PREFS, ...(store.get(UI_PREF_KEY) || {}) };
  for (const key of Object.keys(DEFAULT_UI_PREFS)) {
    if (prefs && Object.prototype.hasOwnProperty.call(prefs, key)) merged[key] = prefs[key];
  }
  store.set(UI_PREF_KEY, merged);
  return { success: true, preferences: merged };
});

ipcMain.handle('ui-preference-reset', () => {
  store.set(UI_PREF_KEY, DEFAULT_UI_PREFS);
  return { success: true, preferences: DEFAULT_UI_PREFS };
});

/**
 * Reasoning/output contract.
 *
 * R1 spends its budget thinking; on long-form turns it can also leak planning
 * text into the answer or exhaust max_tokens before writing anything. This block
 * enforces the separation the UI depends on, and forces both-sides treatment of
 * contested doctrine (2L cases routinely turn on a dissent the majority buries).
 */
const REASONING_CONTRACT = `

REASONING vs OUTPUT — STRICT SEPARATION:
- Do all deliberation and planning internally. The user never sees your scratch work.
- Your final answer must contain ONLY the finished deliverable — no preamble, no "let me think", no restating of these instructions.
- Complete the deliverable inside the response. If the material is long, prioritise finishing every requested tier over adding extra commentary.

BALANCED DOCTRINAL ANALYSIS:
- Where authority is contested, state the majority rule AND the dissent or minority position, with its strongest counter-argument.
- Never collapse a split of authority into a single "correct" answer; flag the split explicitly.
- Never fabricate citations or holdings. If something is outside the provided materials, write: "Outside provided course materials — verify with professor."`;

/**
 * The injectable grounding suffix: reasoning contract + ICM (user's own corpus)
 * + persistent memory + local RAG corpus. Returns only the suffix so both the
 * single-prompt and multi-turn message paths can attach it to their own system
 * message without duplicating the persona block.
 */
async function buildGroundingSuffix(prompt, mode) {
  let memoryContext = '';
  try {
    const sm = getSupermemory();
    if (sm) {
      const memories = await sm.search({ query: prompt });
      if (memories && memories.length > 0) {
        memoryContext = '\n\nSUPERMEMORY (Persistent History):\n' + memories.map(m => m.content || m.text).join('\n');
      }
      await sm.addMemory({ content: prompt, tags: ['chat', mode || 'general'] });
    }
  } catch (smErr) {
    console.warn('[Supermemory skipped]', smErr.message);
  }

  const ragContext = getRelevantContext(prompt, 3);
  const ragBlock = ragContext
    ? `\n\nRELEVANT LEGAL CONTEXT (from local corpus — use this to ground your answer):\n\n${ragContext}`
    : '';

  // ICM: the student's OWN labelled files take precedence over the generic corpus.
  const icmBlock = typeof getIcmContext === 'function' ? getIcmContext(prompt, 4) : '';

  return REASONING_CONTRACT + icmBlock + memoryContext + ragBlock;
}

/**
 * Assemble the complete system prompt for a single prompt/systemPrompt pair.
 * Used by the blocking chat path so it cannot drift from the streaming path.
 */
async function buildGroundingBlocks(prompt, mode, systemPrompt) {
  return (systemPrompt || buildDefaultSystem(mode)) + await buildGroundingSuffix(prompt, mode);
}

/**
 * Compose the final message array for either a single prompt or a multi-turn
 * conversation (used by streaming so "Continue" can carry prior turns).
 */
async function composeMessages({ prompt, systemPrompt, mode, messages }) {
  const list = Array.isArray(messages) ? messages.filter(m => m && m.content) : [];
  const query = prompt
    || [...list].reverse().find(m => m.role === 'user')?.content
    || '';

  const suffix = await buildGroundingSuffix(query, mode);

  if (list.length) {
    const withSystem = list[0].role === 'system'
      ? [{ ...list[0], content: `${list[0].content}${suffix}` }, ...list.slice(1)]
      : [{ role: 'system', content: `${systemPrompt || buildDefaultSystem(mode)}${suffix}` }, ...list];
    return withSystem;
  }

  return [
    { role: 'system', content: `${systemPrompt || buildDefaultSystem(mode)}${suffix}` },
    { role: 'user', content: prompt },
  ];
}


/**
 * Two-stage formatting fallback.
 *
 * R1 is the thinker; it is occasionally poor at rigid formatting and can return
 * empty content when its reasoning exhausts the budget. When that happens we hand
 * the reasoning trace to the cheaper, highly format-stable deepseek-chat model and
 * ask it to emit the finished artifact. Thinking stays on R1; formatting moves off.
 */
async function formatWithChat({ apiKey, rawReasoning, instruction }) {
  return callDeepSeekMain({
    apiKey,
    model: MODEL_IDS.chat,
    maxTokens: 8192,
    messages: [
      {
        role: 'system',
        content: `${instruction}\n\nYou are a formatting engine. Convert the supplied analysis into the exact output format requested. Output the artifact only — no commentary, no markdown fences.`,
      },
      { role: 'user', content: rawReasoning },
    ],
  });
}

/**
 * Hard style contract for outline output.
 *
 * BIA_SYSTEM *describes* the four tiers, and in testing both deepseek-reasoner and
 * deepseek-chat ignored them every single time — substituting #12355B / #F0B429 /
 * #0B5FA5 for the specified #A4B491 / #EBEFE8. Restating the tiers as the PRIMARY
 * requirement, naming the forbidden values explicitly, is what actually holds.
 */
const OUTLINE_STYLE_CONTRACT = `You are converting a legal outline into a fixed house stylesheet.

TIER 1 (major doctrine): <div style="color:#FFFFFF;background-color:#A4B491;padding:14px;text-align:center;font-family:sans-serif;font-weight:bold;font-size:1.15em;">TEXT</div>
TIER 2 (sub-doctrine):   <div style="color:#000000;background-color:#EBEFE8;padding:9px 14px;margin-top:18px;font-family:sans-serif;font-weight:bold;">TEXT</div>
TIER 3 (element):        <div style="border:1.5px solid #A4B491;padding:9px 11px;color:#A4B491;font-weight:bold;text-transform:uppercase;">TEXT</div>
TIER 4 (rule detail):    <strong> for rule definitions, <em><strong> for case citations.
PROFESSOR HOOKS:         prefix with a star character (U+2605).

ABSOLUTE CONSTRAINT — THIS IS THE PRIMARY REQUIREMENT:
Every element MUST use one of the exact style strings given above, copied character for
character. You MUST use the colours #A4B491 and #EBEFE8 and no others for backgrounds.
You MUST NOT invent, substitute, or "improve" any colour, border, or padding. Do not use
#12355B, #F0B429, #0B5FA5 or any other value. Every major doctrine uses TIER 1 verbatim.
Every case citation uses <em><strong>. Every professor hook is prefixed with the star
character. Close every element. Output raw HTML only — no commentary, no markdown fences.

IF THE INPUT IS INCOMPLETE:
The draft below may end mid-tag or mid-sentence. Close the element at the nearest
sentence boundary and then append, on its own line:
<em>(outline continues — regenerate for full version)</em>
Never leave an unclosed tag, and never invent material to fill the gap. A complete-looking
partial document with a visible note is correct; a broken tag is not.`;

/**
 * Second-stage completion for a TRUNCATED artifact.
 *
 * R1 stops at the output cap mid-tag when a whole-subject outline is requested
 * (finish_reason: 'length'), which is a different failure from the empty-content case
 * callDeepSeekMain already retries: the draft is 37k+ characters of perfectly usable
 * outline, so `!content.trim()` is false and the half-written document used to reach
 * the renderer untouched.
 *
 * This hands the draft to the format-stable chat model and asks for the finished
 * artifact in the exact house style, with every element closed. Thinking stays on R1;
 * formatting and completion move off it.
 *
 * The draft is passed to the formatter IN FULL, in order. It is chunked only when it
 * exceeds the per-call limit, and the chunks are concatenated, so no section is ever
 * dropped. (An earlier version kept only the last 48k characters, which silently
 * removed the opening sections of long outlines.)
 */
async function completeWithChat({ apiKey, draft, instruction }) {
  // Reduced letters-and-digits form, used to test whether the formatted result still
  // contains the draft's opening heading.
  const key = (s) => String(s).replace(/&[a-z]+;/gi, ' ').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const firstHeadingKey = (html) => {
    const m = html.match(/>([^<>]{6,140})<\/div>/);
    return m ? key(m[1]).slice(0, 60) : '';
  };

  // The draft is passed IN FULL, in order, chunked only when oversized. It is not
  // trimmed from the front: an earlier version kept only the last 48k characters, which
  // silently removed the opening sections of long outlines.
  const MAX_CHUNK = 48000;   // ~12k tokens per call; leaves room for a full reply
  const chunks = chunkText(draft, MAX_CHUNK);
  const formatted = [];

  for (let i = 0; i < chunks.length; i++) {
    const part = await formatOneChunk({ apiKey, chunk: chunks[i], instruction, index: i, total: chunks.length });
    if (part.trim()) formatted.push(part.trim());
  }

  const completed = formatted.join('\n\n');

  // ── loss guard ────────────────────────────────────────────────────────────
  // The formatter is a rewriting model and has silently dropped the opening of a long
  // draft: a 34,445-character draft that began at "WILLS & TRUSTS — MASTER ANALYTICAL
  // OUTLINE" / "I. FIRST PRINCIPLES" came back starting at "XII. PRINCIPAL AND INCOME",
  // with the first eleven sections gone and invented later ones in their place. The
  // instruction that caused it is fixed above; this guard means that even if it happens
  // again, the content the formatter dropped is never what she receives.
  //
  // The draft is always worth more than the formatting: it is her outline either way,
  // just less pretty.
  const openingKey = firstHeadingKey(draft);
  if (completed && openingKey && !key(completed).includes(openingKey)) {
    console.warn(`[AI Stream] formatter dropped the opening of the draft - returning the draft itself`);
    return draft;
  }

  return completed;
}

/**
 * Format one chunk of a draft into the house stylesheet.
 *
 * `instruction` carries the full style contract for every chunk, so a mid-document
 * chunk is styled exactly like the first. The per-chunk note keeps the model from
 * editorialising at the seams: no introductions, no repeated sections, and - except on
 * the final chunk - no "(outline continues)" note, because the outline does continue
 * and the next chunk is already on its way.
 */
async function formatOneChunk({ apiKey, chunk, instruction, index, total }) {  return callDeepSeekMain({
    apiKey,
    model: MODEL_IDS.chat,
    maxTokens: 32768,
    messages: [
      {
        role: 'system',
        content: `${instruction}${segmentNote}

You are a FORMATTING engine, not an author. The draft below is a finished outline that
needs the house stylesheet applied. Reproduce it in full, from its FIRST line to its last,
in the original order.

WHAT "REPRODUCE" MEANS — THIS IS THE PRIMARY REQUIREMENT:
- Output every section that appears in the draft. All of it, in order, starting with the
  draft's first element.
- An earlier version of this instruction said "do not repeat sections that are already
  complete". A model reading that omitted the opening third of a 34,000-character draft
  and wrote invented later sections in its place. Do NOT interpret this as permission to
  skip, shorten, summarise, reorder, or omit any part of the draft.
- Never drop the beginning to make room for the end. If you must stop early, stop at the
  END and leave the tail unfinished - never discard the opening.
- Do not invent new sections. Complete only the final element if it was cut off mid-tag,
  and then append the incomplete marker on its own line as described above.
- Every case citation is wrapped as <em><strong>. Preserve the ones already in the draft
  and apply the pattern to the rest.
- Output raw HTML only - no commentary, no markdown fences, no preamble.`,
      },
      { role: 'user', content: chunk },
    ],
  });
}

/**
 * Detailed completion: like callDeepSeekMain but also returns the reasoning trace
 * and the stop reason, so a caller can decide whether a second pass is required.
 * Escalates the output budget once, exactly as callDeepSeekMain does.
 */
async function callDeepSeekDetailed({ apiKey, messages, model = MODEL_IDS.reasoner, maxTokens = 8192 }) {
  const key = apiKey || getDeepSeekKey();
  const budgets = [maxTokens, Math.min(maxTokens * 2, 32768)];
  let reasoning = '';
  let finishReason = '';

  for (const budget of budgets) {
    const res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: budget }),
    });

    if (!res.ok) {
      let errMsg = `DeepSeek API HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch { /* empty */ }
      throw new Error(errMsg);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = (choice && choice.message) || {};
    if (msg.reasoning_content) reasoning = msg.reasoning_content;
    finishReason = (choice && choice.finish_reason) || '';
    if (msg.content && msg.content.trim()) {
      return { content: msg.content, reasoning, finishReason };
    }
  }

  return { content: '', reasoning, finishReason };
}

/** True when the text contains a JSON object carrying every required key. */
function jsonHasKeys(raw, keys) {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < s) return false;
    const obj = JSON.parse(raw.slice(s, e + 1));
    return keys.every((k) => obj[k] !== undefined);
  } catch {
    return false;
  }
}

/**
 * Staged (two-pass) generation for rigid output formats — the reasoning/formatting
 * split.
 *
 *   Stage 1 — the reasoning model THINKS: deepseek-reasoner, unrestricted, may
 *             return only a reasoning trace.
 *   Stage 2 — a format-stable model FORMATS: deepseek-chat turns whatever stage 1
 *             produced into the exact schema.
 *
 * Stage 2 runs whenever stage 1 returns nothing usable (empty content, or content
 * missing required keys) — precisely how deepseek-reasoner fails when its
 * chain-of-thought exhausts the output budget. This is what keeps the IRAC/syllabus
 * JSON and the 4-tier outline deterministic instead of intermittently empty.
 */
async function callDeepSeekStructured({ apiKey, messages, maxTokens = 8192, schemaHint = '', requiredKeys = [] }) {
  const stage1Model = getModelPreference() === 'chat' ? MODEL_IDS.chat : MODEL_IDS.reasoner;
  const first = await callDeepSeekDetailed({ apiKey, messages, model: stage1Model, maxTokens });

  const usable = first.content
    && first.content.trim()
    && (requiredKeys.length === 0 || jsonHasKeys(first.content, requiredKeys));
  if (usable) return first.content;

  const trace = (first.content && first.content.trim()) || (first.reasoning || '').trim();
  if (!trace) throw new Error('DeepSeek returned neither a usable answer nor a reasoning trace.');

  // The formatting pass gets its own budget floor: stage 1 may have been given a
  // small budget (or burned it all reasoning), and the formatter must still be able
  // to emit the complete artifact rather than a truncated JSON fragment.
  const formatMaxTokens = Math.max(maxTokens, 4096);

  console.warn(`[Staged ICM] stage 1 unusable (finish_reason=${first.finishReason}) — formatting with ${MODEL_IDS.chat} (${formatMaxTokens} tok)`);
  return callDeepSeekMain({
    apiKey,
    model: MODEL_IDS.chat,
    maxTokens: formatMaxTokens,
    messages: [
      {
        role: 'system',
        content: 'You are a formatting engine. Convert the supplied legal analysis into the exact output format requested. '
          + 'Respond with ONLY the artifact — no markdown fences, no commentary, no preamble.'
          + (schemaHint ? `\n\nREQUIRED FORMAT:\n${schemaHint}` : ''),
      },
      { role: 'user', content: trace },
    ],
  });
}

/** Extract and parse the first JSON object embedded in a model response. */
function parseJsonBlock(raw) {
  const s = String(raw || '').indexOf('{');
  const e = String(raw || '').lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('No JSON object found in the response.');
  return JSON.parse(String(raw).slice(s, e + 1));
}

/**
 * Domain validators for structured IPC calls. Return null when acceptable, or a
 * short human-readable problem description used to drive a repair pass.
 */
const STRUCTURED_VALIDATORS = {
  /**
   * A truncated week list is worse than a clear error: every week must carry a real
   * topic and at least one reading, otherwise the Reading Tracker silently drops
   * classes (26 classes / 13 weeks for the Fall schedule).
   */
  syllabus(obj) {
    if (!obj || typeof obj !== 'object') return 'the response was not a JSON object';
    if (!obj.courseName || !String(obj.courseName).trim()) return 'courseName is empty';
    if (!Array.isArray(obj.weeks) || obj.weeks.length === 0) return 'weeks[] is empty';
    for (let i = 0; i < obj.weeks.length; i++) {
      const w = obj.weeks[i] || {};
      if (!String(w.topic || '').trim()) return `week ${i + 1} ("${w.week ?? '?'}") has an empty topic`;
      const readings = Array.isArray(w.readings) ? w.readings : [];
      if (!readings.length) return `week ${i + 1} has no readings`;
      const blank = readings.find((r) => !String((r && (r.title || r.reading)) || '').trim());
      if (blank) return `week ${i + 1} has a reading with no title`;
    }
    return null;
  },

  /**
   * Reading Tracker shape: { courseName, professor, semester, assignments[], cases[] }.
   * Distinct from `syllabus` (which uses weeks[]/readings[]) because the tracker
   * stores one row per reading with a resolved calendar date — a truncated `cases`
   * list silently loses classes from the schedule.
   */
  readingList(obj) {
    if (!obj || typeof obj !== 'object') return 'the response was not a JSON object';
    if (!obj.courseName || !String(obj.courseName).trim()) return 'courseName is empty';
    if (!Array.isArray(obj.cases) || obj.cases.length === 0) return 'cases[] is empty';

    for (let i = 0; i < obj.cases.length; i++) {
      const c = obj.cases[i] || {};
      if (c.week === undefined || c.week === null || String(c.week).trim() === '') return `cases[${i}] has no week number`;
      if (!String(c.caseName || c.reading || '').trim()) return `cases[${i}] (week ${c.week}) has no caseName/reading`;
      if (!String(c.date || '').trim()) return `cases[${i}] (week ${c.week}) has no date`;

      // Reject the documented "Week N Readings" placeholder when a real topic
      // exists elsewhere for that week — it means the model gave up mid-list.
      if (/^week \d+ readings?$/i.test(String(c.caseName).trim()) && c.doctrineArea) {
        return `cases[${i}] is still the "${c.caseName}" placeholder despite a known topic`;
      }
    }
    return null;
  },
};

// ─── IPC: Structured (JSON) generation from the renderer ─────────────────────
// Single entry point for every JSON-producing call in the UI, so the staged
// pipeline (R1 thinks → V3 formats) and domain validation are never bypassed.
ipcMain.handle('ai:structured', async (_event, {
  prompt, systemPrompt, messages, mode,
  maxTokens = 8192, requiredKeys = [], schemaHint = '', validate = null,
} = {}) => {
  const apiKey = getDeepSeekKey();
  try {
    const chatMessages = await composeMessages({ prompt, systemPrompt, mode, messages });
    let text = await callDeepSeekStructured({ apiKey, messages: chatMessages, maxTokens, schemaHint, requiredKeys });

    const validator = validate ? STRUCTURED_VALIDATORS[validate] : null;
    if (validator) {
      let problem = null;
      try {
        problem = validator(parseJsonBlock(text));
      } catch (parseErr) {
        problem = `the response was unparseable JSON (${parseErr.message})`;
      }

      if (problem) {
        console.warn(`[ai:structured] first pass rejected (${problem}) — running a repair pass`);
        text = await callDeepSeekMain({
          apiKey,
          model: MODEL_IDS.chat,
          maxTokens: Math.max(maxTokens, 4096),
          messages: [
            {
              role: 'system',
              content: `You are a formatting engine. The JSON you are given is incomplete or malformed: ${problem}. `
                + 'Rebuild it as a single complete, valid JSON object with every week fully populated — do not omit, '
                + 'truncate, or summarise any week or reading. Respond with ONLY the JSON, no markdown fences.'
                + (schemaHint ? `\n\nREQUIRED FORMAT:\n${schemaHint}` : ''),
            },
            { role: 'user', content: text },
          ],
        });

        try {
          const stillBad = validator(parseJsonBlock(text));
          if (stillBad) return { success: false, error: `The syllabus could not be parsed cleanly (${stillBad}). Try pasting the schedule text instead.` };
        } catch (parseErr) {
          return { success: false, error: `The syllabus could not be parsed cleanly (${parseErr.message}). Try pasting the schedule text instead.` };
        }
      }
    }

    return { success: true, text };
  } catch (err) {
    console.error('[ai:structured]', err);
    return { success: false, error: err.message || 'Structured generation failed.' };
  }
});

// ─── IPC: Capture document analysis (chunked + staged) ──────────────────────
// Long PDFs (a 10-page exam ≈ 40k chars) exhaust R1's reasoning budget in a
// single pass. Split into ~28k-char chunks at paragraph boundaries, analyze each
// through the staged pipeline, then stitch the result.
const CAPTURE_MAX_CHUNK = 28000;

function chunkText(text, maxLen) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  if (clean.length <= maxLen) return [clean];

  const chunks = [];
  let current = '';
  for (const para of clean.split(/\n{2,}/)) {
    if (!para.trim()) continue;
    if (current && current.length + para.length > maxLen) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [clean];
}

ipcMain.handle('capture:analyze', async (_event, { text, sourceLabel = 'document', systemPrompt, schemaHint } = {}) => {
  const apiKey = getDeepSeekKey();
  if (!text || !String(text).trim()) return { success: false, error: 'No text to analyze.' };

  try {
    const chunks = chunkText(text, CAPTURE_MAX_CHUNK);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${sourceLabel} (part ${i + 1} of ${chunks.length}):\n\n${chunks[i]}\n\nAnalyze this document.` },
      ];
      try {
        const raw = await callDeepSeekStructured({
          apiKey,
          messages,
          maxTokens: 8192,
          requiredKeys: ['extractedText', 'detectedType'],
          schemaHint: schemaHint || 'A single valid JSON object with extractedText, detectedType, suggestedActions, summary.',
        });
        results.push(parseJsonBlock(raw));
      } catch (err) {
        console.warn(`[capture:analyze] chunk ${i + 1}/${chunks.length} failed:`, err.message);
      }
    }

    if (results.length === 0) {
      return {
        success: false,
        finishReason: 'empty',
        error: 'This document was too long to analyze in one pass — try a single page or section.',
      };
    }

    const extractedText = results.map((r) => r.extractedText || '').join('\n\n').trim();
    const detectedType = results.find((r) => r.detectedType && r.detectedType !== 'unknown')?.detectedType
      || results[0].detectedType || 'unknown';
    const summary = results[0].summary || '';
    const actions = [...new Set(results.flatMap((r) => Array.isArray(r.suggestedActions) ? r.suggestedActions : []))];

    return {
      success: true,
      text: JSON.stringify({ extractedText, detectedType, suggestedActions: actions, summary }),
      chunks: chunks.length,
    };
  } catch (err) {
    console.error('[capture:analyze]', err);
    return { success: false, error: err.message || 'Document analysis failed.' };
  }
});

// ─── IPC: Document Generation (IRAC .docx) ───────────────────────────────────
ipcMain.handle('generate-document', async (_event, { caseText, caseName }) => {
  const apiKey = getDeepSeekKey();
  if (!apiKey) {
    return { success: false, error: 'No API key configured. Click Settings to add your DeepSeek API key.' };
  }

  try {
    const messages = [
      {
        role: 'system',
        content: `You are a meticulous legal analyst. Analyze the provided case using the IRAC framework.
Respond ONLY with a valid JSON object (no markdown fences) with exactly these fields:
{
  "issue":       "The precise legal question(s) presented by this case.",
  "rule":        "The applicable legal rules, statutes, constitutional provisions, or binding precedents.",
  "application": "Step-by-step application of the rules to the specific facts of this case.",
  "conclusion":  "The court's holding or the logical conclusion of the analysis.",
  "keyFacts":    "The most important facts that determined the outcome.",
  "significance":"Why this case matters — its lasting legal significance or doctrinal contribution."
}`,
      },
      {
        role: 'user',
        content: `Case Name: ${caseName}\n\nCase Text / Description:\n${caseText}`,
      },
    ];

    const analysisText = await callDeepSeekStructured({
      apiKey,
      messages,
      // Staged pipeline: R1 thinks, then deepseek-chat formats the IRAC JSON if R1
      // returned nothing usable (8K is often consumed entirely by the CoT).
      maxTokens: 16384,
      requiredKeys: ['issue', 'rule', 'application', 'conclusion'],
      schemaHint: 'A single valid JSON object (no markdown fences) with exactly these fields:\n'
        + '{\n  "issue": "the precise legal question(s) presented",\n  "rule": "the applicable rules, statutes or binding precedents",\n'
        + '  "application": "step-by-step application of the rule to the facts",\n  "conclusion": "the holding or logical conclusion",\n'
        + '  "keyFacts": "the facts that determined the outcome",\n  "significance": "the lasting doctrinal contribution of the case"\n}',
    });

    let irac;
    try {
      const raw = analysisText.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      irac = JSON.parse(raw);
    } catch {
      // Fallback: put full response in application field
      irac = {
        issue:       'See full analysis below.',
        rule:        '',
        application: analysisText,
        conclusion:  '',
        keyFacts:    '',
        significance: '',
      };
    }

    // Step 2: Build the .docx document
    const {
      Document, Paragraph, TextRun, HeadingLevel,
      AlignmentType, BorderStyle, Packer,
    } = require('docx');

    const sectionHeading = (text) => new Paragraph({
      heading:   HeadingLevel.HEADING_1,
      spacing:   { before: 320, after: 120 },
      children:  [new TextRun({ text, color: 'D95318', bold: true, size: 28 })],
      border:    { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'F26522' } },
    });

    const bodyParagraph = (text) => new Paragraph({
      spacing: { line: 276, after: 120 },
      children: [new TextRun({ text: text || '—', size: 22, color: '111827' })],
    });

    const dateStr   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timestamp = new Date().toISOString().slice(0, 10);

    const doc = new Document({
      styles: {
        default: {
          document: { run: { font: 'Calibri', size: 22, color: '111827' } },
        },
      },
      sections: [{
        properties: {
          page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        },
        children: [
          // Title block
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { after: 80 },
            children:  [new TextRun({ text: 'IRAC CASE ANALYSIS', bold: true, size: 32, color: 'F26522', font: 'Calibri' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { after: 60 },
            children:  [new TextRun({ text: caseName, bold: true, size: 26, color: '111827', font: 'Calibri' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { after: 480 },
            children:  [new TextRun({ text: `Prepared for Bianna  |  ${dateStr}`, size: 18, color: '6B7280', italics: true })],
          }),

          // IRAC sections
          sectionHeading('I.  ISSUE'),
          bodyParagraph(irac.issue),

          sectionHeading('R.  RULE'),
          bodyParagraph(irac.rule),

          sectionHeading('A.  APPLICATION'),
          bodyParagraph(irac.application),

          sectionHeading('C.  CONCLUSION'),
          bodyParagraph(irac.conclusion),

          ...(irac.keyFacts ? [
            sectionHeading('KEY FACTS'),
            bodyParagraph(irac.keyFacts),
          ] : []),

          ...(irac.significance ? [
            sectionHeading('DOCTRINAL SIGNIFICANCE'),
            bodyParagraph(irac.significance),
          ] : []),

          // Footer note
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:   { before: 720 },
            children:  [new TextRun({
              text:    'Generated by Senior Law Partner  •  For study purposes only',
              size:    16,
              color:   '6B7280',
              italics: true,
            })],
          }),
        ],
      }],
    });

    // Step 3: Save to Documents/Bianna_Law/
    ensureBiannaLawDir();
    const safeName = caseName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
    const fileName  = `${safeName}_IRAC_${timestamp}.docx`;
    const filePath  = path.join(getBiannaLawDir(), fileName);

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);

    // Open the file with the system default app (Word, LibreOffice, etc.)
    await shell.openPath(filePath);

    // Phase 3.3: Sync to Notion asynchronously (non-blocking)
    const notion = getNotionClient();
    if (notion) {
      notion.pages.create({
        parent: { database_id: NOTION_IRAC_DB },
        properties: {
          'Title':        { title:     [{ text: { content: caseName } }] },
          'Type':         { select:    { name: 'IRAC Brief' } },
          'Issue':        { rich_text: [{ text: { content: (irac.issue        || '').slice(0, 2000) } }] },
          'Rule':         { rich_text: [{ text: { content: (irac.rule         || '').slice(0, 2000) } }] },
          'Application':  { rich_text: [{ text: { content: (irac.application  || '').slice(0, 2000) } }] },
          'Conclusion':   { rich_text: [{ text: { content: (irac.conclusion   || '').slice(0, 2000) } }] },
          'Significance': { rich_text: [{ text: { content: (irac.significance || '').slice(0, 2000) } }] },
        },
      }).catch(e => console.warn('[Notion IRAC sync]', e.message));
    }

    return {
      success:  true,
      message:  `IRAC document saved and opened: ${fileName}`,
      filePath,
      notionSynced: !!notion,
    };
  } catch (err) {
    console.error('[generate-document]', err);
    return { success: false, error: err.message || 'Failed to generate document.' };
  }
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('open-settings', () => {
  mainWindow.webContents.send('show-settings-modal');
  return { success: true };
});

// ─── IPC: App Info ────────────────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion());

// ─── IPC: Open Documents Folder ──────────────────────────────────────────────
ipcMain.handle('open-documents-folder', () => {
  shell.openPath(getBiannaLawDir());
  return { success: true };
});

// ─── IPC: List RAG Sources ───────────────────────────────────────────────────
ipcMain.handle('list-rag-sources', () => {
  try {
    const { listSources } = require('./rag');
    return listSources();
  } catch { return []; }
});

// ─── IPC: Notion Key Management ──────────────────────────────────────────────
ipcMain.handle('notion-key-exists', () => !!(store.get('notionApiKey') || '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'));

ipcMain.handle('notion-key-save', (_event, key) => {
  if (!key || typeof key !== 'string' || key.trim().length < 10) {
    return { success: false, error: 'Invalid Notion API key.' };
  }
  store.set('notionApiKey', key.trim());
  return { success: true };
});

ipcMain.handle('notion-key-clear', () => {
  store.delete('notionApiKey');
  return { success: true };
});

// ─── IPC: Notion Sync — Summary / Video / Transcript ─────────────────────────
ipcMain.handle('notion-sync-summary', async (_event, { title, type, topic, summary }) => {
  const notion = getNotionClient();
  if (!notion) return { success: false, error: 'No Notion API key configured.' };
  try {
    await notion.pages.create({
      parent: { database_id: NOTION_IRAC_DB },
      properties: {
        'Title': { title:     [{ text: { content: title || 'Untitled' } }] },
        'Type':  { select:    { name: type  || 'Case Summary' } },
        'Topic': { rich_text: [{ text: { content: topic || '' } }] },
        'Issue': { rich_text: [{ text: { content: summary.slice(0, 2000) } }] },
      },
    });
    return { success: true };
  } catch (err) {
    console.error('[notion-sync-summary]', err);
    return { success: false, error: err.message };
  }
});

// ─── IPC: Notion Sync — Quiz Result ──────────────────────────────────────────
ipcMain.handle('notion-sync-quiz', async (_event, { topic, score, total, difficulty, wrongAnswers }) => {
  const notion = getNotionClient();
  if (!notion) return { success: false, error: 'No Notion API key configured.' };
  try {
    const dateStr     = new Date().toISOString().slice(0, 10);
    const sessionName = `${topic || 'Quiz'} — ${dateStr}`;
    const pct         = total > 0 ? Math.round((score / total) * 100) : 0;
    await notion.pages.create({
      parent: { database_id: NOTION_QUIZ_DB },
      properties: {
        'Session':         { title:     [{ text: { content: sessionName } }] },
        'Date':            { date:      { start: dateStr } },
        'Topic':           { rich_text: [{ text: { content: topic || '' } }] },
        'Score':           { number:    score },
        'Total Questions': { number:    total },
        'Percentage':      { number:    pct },
        'Difficulty':      { select:    { name: difficulty || 'Medium' } },
        'Wrong Answers':   { rich_text: [{ text: { content: wrongAnswers || '' } }] },
      },
    });
    return { success: true };
  } catch (err) {
    console.error('[notion-sync-quiz]', err);
    return { success: false, error: err.message };
  }
});

// ─── IPC: Notion Syllabus Organizer ──────────────────────────────────────────
// Workflow:
//   1. DeepSeek R1 extracts structured week/topic/reading data from syllabus text
//   2. Creates a rich Notion page under the main workspace page with:
//      - Color-coded priority sections (🔴 High / 🟡 Medium / 🟢 Low)
//      - Per-week reading tables with volume, difficulty, and due date columns
ipcMain.handle('organize-syllabus', async (_event, { syllabusText, courseName }) => {
  const apiKey = getDeepSeekKey();
  if (!apiKey) return { success: false, error: 'No API key configured.' };

  const notionKey = (store.get('notionApiKey') || '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');
  if (!notionKey) return { success: false, error: 'No Notion key configured. Add it in Settings.' };

  try {
    const messages = [
      {
        role: 'system',
        content: `You are a legal study organizer. Extract a structured study plan from the provided law school syllabus.
Respond ONLY with a valid JSON object (no markdown fences):
{
  "courseName": "...",
  "professor": "...",
  "semester": "...",
  "weeks": [
    {
      "week": 1,
      "dateRange": "Jan 13-17",
      "topic": "Introduction to Civil Procedure",
      "readings": [
        {
          "title": "Reading title or case name",
          "pages": "pp. 1-45",
          "priority": "High|Medium|Low",
          "difficulty": "Hard|Medium|Easy",
          "notes": "Brief note on why this matters"
        }
      ],
      "assignments": "Any assignments or problems due"
    }
  ],
  "keyThemes": ["theme1", "theme2"],
  "examDates": ["date1: description"]
}
Infer difficulty from page count (>30 pages = Hard, 15-30 = Medium, <15 = Easy).
Infer priority from position in semester and topic weight (foundational doctrine = High).`,
      },
      {
        role: 'user',
        content: `Course: ${courseName}\n\nSyllabus:\n${syllabusText.slice(0, 8000)}`,
      },
    ];

    const extractText = await callDeepSeekStructured({
      apiKey,
      messages,
      maxTokens: 8192,
      requiredKeys: ['courseName', 'weeks'],
      schemaHint: 'A single valid JSON object (no markdown fences) shaped exactly:\n'
        + '{\n  "courseName": "string",\n  "weeks": [\n    { "week": 1, "topic": "string", "readings": [ { "title": "string", "priority": "High|Medium|Low" } ] }\n  ]\n}',
    });

    let syllabus;
    try {
      const raw = extractText.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      syllabus  = JSON.parse(raw);
    } catch {
      return { success: false, error: 'Could not parse syllabus structure. Try a cleaner text copy.' };
    }

    // Step 2: Build Notion page blocks
    const { Client } = require('@notionhq/client');
    const notion      = new Client({ auth: notionKey });
    const NOTION_PARENT_PAGE = '79b6e34b-17ea-412e-8914-5790e8012300';

    // Helper: rich text block
    const rt  = (text, bold = false, color = 'default') => ({
      type: 'text', text: { content: text }, annotations: { bold, color },
    });
    const heading2 = (text) => ({
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [rt(text, true)], color: 'default' },
    });
    const bullet = (text, color = 'default') => ({
      object: 'block', type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [rt(text)], color },
    });
    const divider = () => ({ object: 'block', type: 'divider', divider: {} });
    const callout = (icon, text, bgColor) => ({
      object: 'block', type: 'callout',
      callout: { icon: { type: 'emoji', emoji: icon }, rich_text: [rt(text)], color: bgColor },
    });

    const priorityIcon  = (p) => p === 'High' ? '🔴' : p === 'Medium' ? '🟡' : '🟢';
    const priorityColor = (p) => p === 'High' ? 'red_background' : p === 'Medium' ? 'yellow_background' : 'green_background';
    const diffIcon      = (d) => d === 'Hard' ? '🧠' : d === 'Medium' ? '📖' : '✅';

    const pageBlocks = [
      // Header callout
      callout('⚖️', `${syllabus.courseName || courseName}  •  ${syllabus.professor || ''}  •  ${syllabus.semester || ''}`, 'blue_background'),
      divider(),
    ];

    // Key themes
    if (syllabus.keyThemes?.length) {
      pageBlocks.push(heading2('📌 Key Themes'));
      syllabus.keyThemes.forEach(t => pageBlocks.push(bullet(t)));
      pageBlocks.push(divider());
    }

    // Exam dates
    if (syllabus.examDates?.length) {
      pageBlocks.push(heading2('📅 Important Dates'));
      syllabus.examDates.forEach(d => pageBlocks.push(callout('🗓️', d, 'orange_background')));
      pageBlocks.push(divider());
    }

    // Per-week sections
    pageBlocks.push(heading2('📚 Weekly Reading Schedule'));
    for (const week of (syllabus.weeks || [])) {
      // Week header
      pageBlocks.push({
        object: 'block', type: 'heading_3',
        heading_3: {
          rich_text: [rt(`Week ${week.week}: ${week.topic}`, true)],
          color: 'default',
        },
      });
      if (week.dateRange) {
        pageBlocks.push(bullet(`📅 ${week.dateRange}`));
      }
      // Readings
      for (const r of (week.readings || [])) {
        const icon  = priorityIcon(r.priority);
        const diff  = diffIcon(r.difficulty);
        const label = `${icon} ${diff}  ${r.title}${r.pages ? `  (${r.pages})` : ''}${r.notes ? `  — ${r.notes}` : ''}`;
        pageBlocks.push(callout(icon, label, priorityColor(r.priority)));
      }
      if (week.assignments) {
        pageBlocks.push(bullet(`📝 Due: ${week.assignments}`, 'purple'));
      }
    }

    // Priority legend footer
    pageBlocks.push(divider());
    pageBlocks.push(callout('📊', 'Priority: 🔴 High (foundational) · 🟡 Medium · 🟢 Low  |  Difficulty: 🧠 Hard · 📖 Medium · ✅ Easy', 'gray_background'));

    // Step 3: Create the Notion page — Notion API accepts max 100 blocks per request
    const dateStr  = new Date().toISOString().slice(0, 10);
    const pageTitle = `📚 ${syllabus.courseName || courseName} — Syllabus (${dateStr})`;

    const page = await notion.pages.create({
      parent: { page_id: NOTION_PARENT_PAGE },
      properties: {
        title: { title: [{ text: { content: pageTitle } }] },
      },
      children: pageBlocks.slice(0, 100),
    });

    // Append remaining blocks if > 100
    if (pageBlocks.length > 100) {
      await notion.blocks.children.append({
        block_id: page.id,
        children: pageBlocks.slice(100),
      });
    }

    return {
      success:   true,
      pageUrl:   page.url,
      weekCount: (syllabus.weeks || []).length,
      course:    syllabus.courseName || courseName,
    };
  } catch (err) {
    console.error('[organize-syllabus]', err);
    return { success: false, error: err.message };
  }
});

// ─── IPC: Sidebar — List & Open Bianna_Law Files ─────────────────────────────
ipcMain.handle('list-bianna-files', () => {
  const dir = getBiannaLawDir();
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile())
      .map(e => {
        const filePath = path.join(dir, e.name);
        const stat     = fs.statSync(filePath);
        return { name: e.name, path: filePath, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
  } catch {
    return [];
  }
});

// open-bianna-file kept for any legacy callers; preview-file is the preferred in-app viewer
ipcMain.handle('open-bianna-file', (_event, filePath) => {
  shell.openPath(filePath);
  return { success: true };
});

// ─── Document text extraction (shared by every ingestion path) ───────────────
/**
 * Extract text from a PDF, tolerating BOTH pdf-parse major versions.
 *
 * pdf-parse v1 exported a bare function (`module.exports = function`), while the
 * installed v2.x is a full TypeScript rewrite that exports a `PDFParse` class and
 * no longer ships the `lib/pdf-parse.js` subpath. Calling the v2 module directly
 * produced the "pdfParse is not a function" crash in Capture.
 *
 * @returns {Promise<{ text: string, pages: number }>}
 */
/**
 * pdf-parse emits page-separator markers ("-- 1 of 3 --") even when a page has no
 * text layer. Left in place they masquerade as content — a scanned PDF would be
 * treated as successfully read and its separators sent to the model.
 */
function stripPdfPageArtifacts(text) {
  return String(text || '')
    .replace(/^[ \t]*-{2,}[ \t]*\d+[ \t]*of[ \t]*\d+[ \t]*-{2,}[ \t]*$/gm, '')
    .replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, '');
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mod = require('pdf-parse');

  // v2.x — class API: new PDFParse({ data }).getText()
  if (mod && typeof mod.PDFParse === 'function') {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return { text: stripPdfPageArtifacts(result && result.text), pages: (result && result.total) || 0 };
    } finally {
      try { await parser.destroy(); } catch { /* already released */ }
    }
  }

  // v1.x — the module itself is the parse function
  if (typeof mod === 'function') {
    const data = await mod(buffer, { max: 0 });
    return { text: stripPdfPageArtifacts(data && data.text), pages: (data && data.numpages) || 0 };
  }

  // v1.x installed elsewhere — the old subpath (absent in v2, hence the try/catch)
  try {
    const legacy = require('pdf-parse/lib/pdf-parse.js');
    if (typeof legacy === 'function') {
      const data = await legacy(buffer, { max: 0 });
      return { text: stripPdfPageArtifacts(data && data.text), pages: (data && data.numpages) || 0 };
    }
  } catch { /* expected on v2 */ }

  throw new Error('Unrecognised pdf-parse export shape (expected a v1 function or a v2 PDFParse class).');
}

/** Extract plain text from .pdf / .docx / .txt / .md. Throws with a clear message. */
async function extractDocumentText(filePath, maxChars = 12000) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';

  if (ext === '.pdf') {
    const { text: pdfText } = await extractPdfText(filePath);
    text = pdfText;
  } else if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value || '';
  } else {
    text = fs.readFileSync(filePath, 'utf8');
  }

  if (!text || !text.trim()) {
    // Scanned/image-only PDF has no text layer — the UI offers paste capture.
    throw new Error('No selectable text found in this file (it may be a scan). Try pasting the pages instead.');
  }

  return text.length > maxChars
    ? text.slice(0, maxChars) + `\n\n[… document truncated at ${maxChars} characters]`
    : text;
}

// ─── IPC: Native In-App File Preview ─────────────────────────────────────────
// Returns enough info for the renderer to display the file inside the webview
// without opening any external application.
//   PDF  → { type: 'pdf',  url: 'file:///...' }
//   DOCX → { type: 'docx', html: '<html>...' }
//   TXT/MD → { type: 'text', text: '...' }
ipcMain.handle('preview-file', async (_event, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.pdf') {
      // Chromium's built-in PDF viewer handles file:// URLs natively
      const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
      return { success: true, type: 'pdf', url: fileUrl };
    }

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result  = await mammoth.convertToHtml({ path: filePath });
      // Wrap in a minimal HTML page with light styling
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: Calibri, Georgia, serif; max-width: 820px; margin: 40px auto; padding: 0 24px; font-size: 14px; line-height: 1.7; color: #111827; }
  h1,h2,h3 { color: #1A1A2E; margin-top: 1.4em; }
  p { margin: 0.6em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  td, th { border: 1px solid #D1D5DB; padding: 6px 10px; }
</style></head><body>${result.value}</body></html>`;
      return { success: true, type: 'docx', html };
    }

    // TXT / MD and any other readable text format
    const text = fs.readFileSync(filePath, 'utf8');
    return { success: true, type: 'text', text };
  } catch (err) {
    console.error('[preview-file]', err);
    return { success: false, error: err.message };
  }
});

// ─── YouTube transcript loader (ESM/CJS interop) ─────────────────────────────
// youtube-transcript@1.3.0 declares "type":"module" but ships a CommonJS build
// as its main entry, so `require('youtube-transcript')` throws
// "exports is not defined in ES module scope". Load the CJS bundle explicitly.
let _ytCache = null;
function loadYoutubeTranscript() {
  if (_ytCache) return _ytCache;
  const Module = require('module');
  const file = require.resolve('youtube-transcript'); // dist/youtube-transcript.common.js
  const src  = fs.readFileSync(file, 'utf8');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  _ytCache = m.exports;
  return _ytCache;
}

// ─── IPC: YouTube Transcript Extraction ──────────────────────────────────────
ipcMain.handle('extract-youtube-transcript', async (_event, videoUrl) => {
  try {
    const { YoutubeTranscript } = loadYoutubeTranscript();
    // Accept watch URLs, embed URLs, and short youtu.be links
    const idMatch = videoUrl.match(/(?:v=|embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (!idMatch) return { success: false, error: 'Could not extract video ID from URL.' };
    const videoId = idMatch[1];
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segments.map(s => s.text.trim()).join(' ');
    return { success: true, transcript: text };
  } catch (err) {
    console.warn('[extract-youtube-transcript]', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Persistent study memory (local files — no external service) ─────────────
// Long-term study notes and daily session logs are appended to Markdown files
// under Documents/Bianna_Law/Memory so the assistant can recall past sessions.
const http  = require('http');
const https = require('https');

// Fetch a public URL with browser-like headers (used by playlist scraper)
function fetchYouTubePage(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, (res) => {
      // Follow one level of redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchYouTubePage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end',  () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('YouTube fetch timed out')); });
  });
}

function getMemoryDir() {
  return path.join(getBiannaLawDir(), 'Memory');
}

// type='daily'    → Memory/daily/YYYY-MM-DD.md  (session notes, quiz results)
// type='longterm' → Memory/MEMORY.md            (course facts, professor quirks)
ipcMain.handle('memory:write', async (_event, { content, type = 'daily', heading }) => {
  try {
    const memoryDir = getMemoryDir();
    fs.mkdirSync(path.join(memoryDir, 'daily'), { recursive: true });
    const filePath = type === 'longterm'
      ? path.join(memoryDir, 'MEMORY.md')
      : path.join(memoryDir, 'daily', `${new Date().toISOString().slice(0, 10)}.md`);

    const time  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const label = heading ? `### ${heading} (${time})` : `### ${time}`;
    fs.appendFileSync(filePath, `\n${label}\n\n${content}\n`, 'utf8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Search the local memory Markdown files (simple substring match, no service).
ipcMain.handle('memory:search', async (_event, { query, limit = 10 }) => {
  try {
    const memoryDir = getMemoryDir();
    if (!fs.existsSync(memoryDir)) return { success: true, results: [] };

    const files = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { walk(p); continue; }
        if (name.endsWith('.md')) files.push(p);
      }
    };
    walk(memoryDir);

    const q = String(query || '').toLowerCase();
    const results = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        if (q && line.toLowerCase().includes(q)) {
          results.push({ file: path.basename(f), line: i + 1, text: line.trim() });
        }
      });
    }
    return { success: true, results: results.slice(0, limit) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: App Diagnostics (for the Troubleshoot modal) ───────────────────────
// Collects the full system state so the renderer can display it and ask DeepSeek R1
// to analyse what's wrong and suggest/apply fixes.
// Open a URL in the user's default browser (used for Google/Apple Calendar export)
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('app:diagnostics', async () => {
  const os = require('os');

  // Check the study corpus in the Bianna_Law dir + ICM index
  const biannaDir = getBiannaLawDir();
  let fileCount = 0;
  try {
    const files = fs.readdirSync(biannaDir).filter((f) => f !== 'Memory');
    fileCount = files.length;
  } catch { /* dir not yet created */ }

  const icm = getIcm();
  const icmStats = icm ? icm.stats() : { files: 0, byDiscipline: {}, byDocType: {} };

  return {
    appVersion:       app.getVersion(),
    platform:         process.platform,
    nodeVersion:      process.version,
    isPackaged:       app.isPackaged,
    apiKeyPresent:    !!(getDeepSeekKey()),
    notionKeyPresent: !!(store.get('notionApiKey') || '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'),
    biannaDir,
    biannaFileCount:  fileCount,
    icmIndexed:       icmStats.files,
    icmByDiscipline:  icmStats.byDiscipline,
    icmByDocType:     icmStats.byDocType,
    homedir:          os.homedir(),
    freeMemMb:        Math.round(os.freemem() / 1024 / 1024),
  };
});

// ─── IPC: Profile & Calendar persistence (electron-store) ────────────────────
ipcMain.handle('profile:get', () => {
  return { success: true, profile: store.get('userProfile', null) };
});

ipcMain.handle('profile:save', (_event, profile) => {
  try {
    if (profile && profile.photoBase64 && String(profile.photoBase64).length > 2_900_000) {
      return { success: false, error: 'Profile photo is too large (max ~2 MB).' };
    }
    store.set('userProfile', profile);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('calendar:get', () => {
  return { success: true, events: store.get('calendarEvents', []) };
});

ipcMain.handle('calendar:save', (_event, events) => {
  try {
    store.set('calendarEvents', Array.isArray(events) ? events : []);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC: Scan & Auto-Sort Legal Files ───────────────────────────────────────
// Opens a native folder picker, walks files recursively, uses DeepSeek R1 to classify
// each file as a course syllabus or document, copies them into Bianna_Law
// subdirectories, and returns structured data for the renderer to import.
ipcMain.handle('scan-legal-files', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title:       'Select Your Law School Files Folder',
    buttonLabel: 'Scan & Import',
    properties:  ['openDirectory'],
    defaultPath: app.getPath('documents'),
  });
  if (canceled || !filePaths[0]) return { success: false, canceled: true };
  const scanPath = filePaths[0];

  // Walk directory recursively — cap at 150 files to keep call fast
  const LEGAL_EXTS  = new Set(['.pdf', '.docx', '.txt', '.md', '.rtf']);
  const MAX_FILES   = 150;
  const collected   = [];

  function walkDir(dir, depth) {
    if (depth > 5 || collected.length >= MAX_FILES) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (collected.length >= MAX_FILES) break;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (LEGAL_EXTS.has(ext)) collected.push({ name: entry.name, fullPath, ext });
        }
      }
    } catch { /* skip permission-denied dirs */ }
  }
  walkDir(scanPath, 0);

  if (collected.length === 0) {
    return { success: true, courses: [], documents: [], total: 0, scanPath, message: 'No legal documents found.' };
  }

  // Read a short text snippet from plaintext files to give context
  const fileInfos = collected.map((f, i) => {
    let snippet = '';
    try {
      if (f.ext === '.txt' || f.ext === '.md') {
        snippet = fs.readFileSync(f.fullPath, 'utf8').slice(0, 350).replace(/\s+/g, ' ');
      }
    } catch { /* skip */ }
    return { index: i + 1, name: f.name, fullPath: f.fullPath, snippet };
  });

  // Ask DeepSeek R1 to classify all files in one shot
  const apiKey = getDeepSeekKey();
  try {
    const fileList = fileInfos.map(f =>
      `${f.index}. "${f.name}"${f.snippet ? `\n   Hint: ${f.snippet.slice(0, 200)}` : ''}`
    ).join('\n\n');

    const messages = [
      {
        role: 'system',
        content: `You are a law school file organizer for a 1L student. Classify each numbered file.
Respond ONLY with valid JSON (no markdown fences):
{
  "courses": [
    { "index": 1, "courseName": "Civil Procedure", "professor": "Prof. Smith", "semester": "Spring 2026", "fileName": "syllabus_civpro.pdf" }
  ],
  "documents": [
    { "index": 2, "title": "Palsgraf v. Long Island Railroad", "type": "case_brief", "subject": "torts", "fileName": "palsgraf.docx" }
  ]
}
Rules:
- "courses" = syllabi or course schedules (week-by-week reading lists, exam schedules)
- "documents" = case briefs, outlines, memos, notes, problem sets, flash cards, study guides
- Omit personal/non-law files from both arrays (photos, receipts, etc.)
- "subject" must be one of: contracts, torts, civ_pro, constitutional, criminal, property, other
- "type" must be one of: case_brief, outline, memo, note, problem_set, flash_cards, syllabus, other`,
      },
      {
        role: 'user',
        content: `Classify these ${fileInfos.length} files from "${scanPath}":\n\n${fileList}`,
      },
    ];

    const classifyText = await callDeepSeekStructured({
      apiKey,
      messages,
      maxTokens: 8192,
      requiredKeys: ['courses'],
      schemaHint: 'A single valid JSON object (no markdown fences) shaped exactly:\n'
        + '{\n  "courses":    [ { "index": 1, "courseName": "string", "professor": "string|null", "semester": "Season YYYY", "discipline": "contracts|torts|civ_pro|constitutional|property|criminal|evidence|legal_writing|other" } ],\n'
        + '  "documents":  [ { "index": 1, "title": "string", "type": "outline|case_brief|notes|syllabus|exam|checklist|supplement|flashcard", "subject": "string", "discipline": "string" } ]\n}',
    });

    const raw        = classifyText.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
    const classified = JSON.parse(raw);

    // Copy files into organised Bianna_Law subdirectories
    const biannaDir  = getBiannaLawDir();
    const coursesDir = path.join(biannaDir, 'Courses');
    const docsDir    = path.join(biannaDir, 'Documents');
    fs.mkdirSync(coursesDir, { recursive: true });
    fs.mkdirSync(docsDir,    { recursive: true });

    const courses = [];
    for (const c of (classified.courses || [])) {
      const src = fileInfos[c.index - 1];
      if (!src) continue;
      try { fs.copyFileSync(src.fullPath, path.join(coursesDir, src.name)); } catch { /* skip */ }
      courses.push({ ...c, fileName: src.name });
    }

    const documents = [];
    for (const d of (classified.documents || [])) {
      const src = fileInfos[d.index - 1];
      if (!src) continue;
      try { fs.copyFileSync(src.fullPath, path.join(docsDir, src.name)); } catch { /* skip */ }
      documents.push({ ...d, fileName: src.name });
    }

    // Newly sorted files are immediately part of the reasoning corpus, so the very
    // next question can be answered from them without a manual re-scan.
    let icmIndexed = 0;
    try {
      const icm = getIcm();
      if (icm) {
        const icmResult = await icm.sync(getBiannaLawDir());
        icmIndexed = icmResult.indexed;
        console.log(`[ICM] corpus refreshed after scan: ${icmResult.indexed} files`);
      }
    } catch (icmErr) {
      console.warn('[ICM] post-scan refresh skipped:', icmErr.message);
    }

    return { success: true, courses, documents, total: fileInfos.length, scanPath, icmIndexed };
  } catch (err) {
    console.error('[scan-legal-files]', err);
    return { success: false, error: err.message };
  }
});

// ─── YouTube pipeline: bounded stages ────────────────────────────────────────
/**
 * Bound a promise so no stage of a long pipeline can hang the UI.
 *
 * Every network step in the playlist handler goes through this. An unbounded await is
 * what turns one stalled fetch into a permanent "Processing…" with no way back.
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/** Set by the Cancel button; the per-video loop checks it between calls. */
let youtubeRunCancelled = false;

ipcMain.handle('youtube:cancel', () => {
  youtubeRunCancelled = true;
  return { success: true };
});
// ─── Part 4: persistent chat threads ─────────────────────────────────────────
/**
 * One append-only markdown file per action per day, at
 *   ~/Documents/Bianna_Law/AI-assistant-chat-instance-memory/YYYY/MM/DD/{action}.md
 *
 * Append-only is the point: a crash mid-turn can truncate the last write but cannot
 * corrupt earlier history. Date-nested folders keep every file small and make a
 * date-range walk trivial.
 */
const CHAT_MEMORY_DIRNAME = 'AI-assistant-chat-instance-memory';

/** Half the 32K thread cap, leaving room for new turns in the same conversation. */
const CHAT_LOAD_TOKEN_BUDGET = 16000;

/** Rough but consistent with the rest of the app: ~4 characters per token. */
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

/** Actions are a closed set; anything else would be a path-traversal vector. */
const CHAT_ACTIONS = new Set([
  'case-research', 'rule-analysis', 'memory-recall', 'case-brief', 'exam-prep', 'study-schedule',
]);

function chatMemoryRoot() {
  // Test isolation. The packaged gates append real turns, and an append-only store
  // accumulates across runs - so a fixture that asserts an absolute turn count has to point
  // the loader at its own root, or the second run fails on the first run's history. This is
  // an environment variable read in the MAIN process, so the renderer cannot influence it
  // and production never sets it.
  const override = process.env.SLP_CHAT_ROOT;
  if (override && String(override).trim()) return String(override).trim();
  return path.join(getBiannaLawDir(), CHAT_MEMORY_DIRNAME);
}

/** Sanitise an action into a filename segment. Rejects anything unexpected. */
function safeChatAction(action) {
  const a = String(action || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!CHAT_ACTIONS.has(a)) return null;
  return a;
}

/** `YYYY-MM-DD` for a Date, in local time (a "day" is her day, not UTC's). */
function chatDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Absolute path of an action's file for a given `YYYY-MM-DD`. */
function chatFilePath(action, dateKey) {
  const [y, m, d] = String(dateKey).split('-');
  if (!y || !m || !d) return null;
  return path.join(chatMemoryRoot(), y, m, d, `${action}.md`);
}

/** Existing day keys for an action, newest first. */
function listChatDaysFor(action) {
  const root = chatMemoryRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const y of fs.readdirSync(root)) {
    if (!/^\d{4}$/.test(y)) continue;
    for (const m of fs.readdirSync(path.join(root, y))) {
      if (!/^\d{2}$/.test(m)) continue;
      for (const d of fs.readdirSync(path.join(root, y, m))) {
        if (!/^\d{2}$/.test(d)) continue;
        if (fs.existsSync(path.join(root, y, m, d, `${action}.md`))) out.push(`${y}-${m}-${d}`);
      }
    }
  }
  return out.sort().reverse();
}

/** Parse one day's file into turns. Tolerant: a malformed block is skipped, not fatal. */
function readChatDay(action, dateKey) {
  const file = chatFilePath(action, dateKey);
  if (!file || !fs.existsSync(file)) return [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }

  const messages = [];
  // Blocks look like: "## 21:34:12 — assistant\n<content>"
  for (const block of text.split(/\n(?=##\s)/)) {
    const m = block.match(/^##\s+(\d{2}:\d{2}:\d{2})\s+.\s+(user|assistant)\s*\n([\s\S]*)$/);
    if (!m) continue;
    const content = m[3].replace(/\s+$/, '');
    if (!content) continue;
    messages.push({ role: m[2], content, ts: `${dateKey}T${m[1]}`, date: dateKey });
  }
  return messages;
}

/** Append one turn, creating the day's folder and header on first write. */
function appendChatTurnRaw(action, role, content) {
  const dateKey = chatDateKey();
  const file = chatFilePath(action, dateKey);
  if (!file) throw new Error('Unrecognized chat action.');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const stamp = new Date().toTimeString().slice(0, 8);
  const clean = String(content ?? '').replace(/\r\n/g, '\n').trim();
  if (!clean) throw new Error('Nothing to record.');

  if (!fs.existsSync(file)) {
    const title = action.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    fs.writeFileSync(file, `# ${title} — ${dateKey}\n`, 'utf8');
  }
  // Append-only: no read-modify-write, so a crash can only ever cost the turn in flight.
  fs.appendFileSync(file, `\n## ${stamp} — ${role}\n${clean}\n`, 'utf8');
  return { file, dateKey, ts: `${dateKey}T${stamp}` };
}

/** IPC: append one turn to today's thread for an action. */
ipcMain.handle('ai-chat:append-turn', (_event, { action, role, content } = {}) => {
  const a = safeChatAction(action);
  if (!a) return { success: false, error: 'Unrecognized chat action.' };
  const r = String(role || '').toLowerCase();
  if (r !== 'user' && r !== 'assistant') return { success: false, error: 'role must be user or assistant.' };
  try {
    const info = appendChatTurnRaw(a, r, content);
    return { success: true, ...info };
  } catch (err) {
    console.error('[ai-chat:append-turn]', err);
    return { success: false, error: err.message };
  }
});

/** IPC: day keys that hold a thread for an action, newest first. */
ipcMain.handle('ai-chat:list-days', (_event, { action } = {}) => {
  const a = safeChatAction(action);
  if (!a) return { success: false, days: [], error: 'Unrecognized chat action.' };
  try {
    return { success: true, days: listChatDaysFor(a) };
  } catch (err) {
    return { success: false, days: [], error: err.message };
  }
});

/**
 * IPC: load a thread, walking BACKWARD through days until the token budget is spent.
 *
 * Loading only today's file was the design's real gap: she would open Exam Prep the next
 * morning to an empty chat and conclude her conversation had vanished - it had not, it was
 * in yesterday's file, and nothing looked there. The date-nested layout stays; the loader
 * simply keeps going backwards while there is room. Cross-midnight sessions continue
 * seamlessly, and anything older than the budget remains reachable through recall.
 */
ipcMain.handle('ai-chat:load-thread', (_event, { action, maxTokens } = {}) => {
  const a = safeChatAction(action);
  if (!a) return { success: false, messages: [], error: 'Unrecognized chat action.' };
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : CHAT_LOAD_TOKEN_BUDGET;

  try {
    const days = listChatDaysFor(a);
    let messages = [];
    let tokens = 0;
    let daysLoaded = 0;

    for (const dateKey of days) {
      const day = readChatDay(a, dateKey);
      if (!day.length) continue;
      const dayTokens = day.reduce((n, m) => n + estimateTokens(m.content), 0);
      // Stop before crossing the budget. Always take at least one day, so a single very
      // long day still opens rather than presenting an empty thread.
      if (daysLoaded > 0 && tokens + dayTokens > budget) break;
      messages = [...day, ...messages];
      tokens += dayTokens;
      daysLoaded++;
    }

    return {
      success: true,
      messages,
      daysLoaded,
      tokens,
      budget,
      truncated: daysLoaded < days.length,
      oldestLoaded: messages.length ? messages[0].date : null,
    };
  } catch (err) {
    console.error('[ai-chat:load-thread]', err);
    return { success: false, messages: [], error: err.message };
  }
});

/**
 * IPC: find earlier conversations across every stored thread.
 *
 * Scored with icm.js's own tokenizer and phrase matcher, so chat recall and corpus search
 * agree on what counts as a match - deliberately not a second retrieval stack.
 */
ipcMain.handle('ai-chat:recall', async (_event, { query, limit = 5, maxDays = 60 } = {}) => {
  const q = String(query || '').trim();
  if (!q) return { success: false, relevant: [], error: 'A query is required.' };

  try {
    const icm = getIcm();
    if (!icm || typeof icm.tokenize !== 'function') {
      return { success: false, relevant: [], error: 'Tokeniser unavailable.' };
    }
    const qTokens = [...new Set(icm.tokenize(q))];
    if (!qTokens.length) return { success: true, relevant: [] };
    const patterns = typeof icm.phrasePatterns === 'function' ? icm.phrasePatterns(qTokens) : [];

    const hits = [];
    for (const action of CHAT_ACTIONS) {
      let scanned = 0;
      for (const dateKey of listChatDaysFor(action)) {
        if (scanned++ >= maxDays) break;
        for (const msg of readChatDay(action, dateKey)) {
          const folded = icm.tokenize(msg.content);
          const set = new Set(folded);
          const matched = qTokens.filter((t) => set.has(t)).length;
          if (!matched) continue;
          let score = matched * 10;
          // Rarer query words matter more; a full phrase is worth more than its parts.
          for (const p of patterns) {
            if (p.test(msg.content)) { score += 40; break; }
          }
          if (msg.role === 'user') score += 5;
          hits.push({
            action,
            date: dateKey,
            role: msg.role,
            ts: msg.ts,
            score,
            excerpt: msg.content.replace(/\s+/g, ' ').slice(0, 240),
          });
        }
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return { success: true, relevant: hits.slice(0, limit), scannedActions: CHAT_ACTIONS.size };
  } catch (err) {
    console.error('[ai-chat:recall]', err);
    return { success: false, relevant: [], error: err.message };
  }
});


const YOUTUBE_VIDEO_SYSTEM =
  'You are Bianna\'s Senior Law Partner AI. Summarise a single law-school lecture transcript '
  + 'as a compact hierarchical outline using the Bia 4-tier format:\n\n'
  + 'I.  MAJOR DOCTRINE\n  A.  Sub-doctrine / Rule\n    1.  Element or test\n      a.  Exception / detail\n\n'
  + 'For each case discussed include a compact IRAC. Label professor-highlighted cases with ★. '
  + 'Output raw HTML in the house four-tier stylesheet only - no markdown fences, no preamble. '
  + 'Never fabricate a case citation or holding; if the transcript is unclear, say so.';

const YOUTUBE_MERGE_SYSTEM =
  'You are Bianna\'s Senior Law Partner AI. You are given per-lecture outline sections from one '
  + 'course. Merge them into ONE comprehensive, hierarchical law-school outline in the Bia 4-tier '
  + 'format:\n\nI.  MAJOR DOCTRINE\n  A.  Sub-doctrine / Rule\n    1.  Element or test\n      a.  Exception / detail\n\n'
  + 'Group content by legal topic, not by lecture order. Remove duplication, keep every case and rule, '
  + 'and label professor-highlighted cases with ★. Output raw HTML in the house four-tier stylesheet '
  + 'only - no markdown fences, no preamble. Never fabricate a case citation or holding.';

// ─── IPC: YouTube Playlist → Outline ─────────────────────────────────────────
// Resolves a playlist, fetches captions (partial success is fine), outlines each video,
// merges the sections, and saves to Documents/Bianna_Law/Outlines/.
//
// STAGE VOCABULARY, shared with Capture.tsx: extracting → generating → saving → done,
// plus error. Field names matter as much as stage names. The previous version emitted
// `step` while the UI read `message`, and `complete` while the UI tested for `done`, so
// every progress event was discarded and the button sat on "Processing…" no matter what
// the pipeline actually did. That mismatch - not missing telemetry - was the bug.
// The renderer has always called this with `{ url }` while this handler read
// `{ playlistUrl }`, so the URL was undefined, the regexes matched nothing, and the
// handler returned "Unrecognized YouTube link" instantly - a result the UI never
// inspected, which is why the button sat on "Processing…" and the pipeline never ran.
// Both names are accepted so neither side can reintroduce the mismatch.
ipcMain.handle('process-youtube-playlist', async (_event, { playlistUrl, url: urlAlias } = {}) => {
  const send = (stage, message, extra = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playlist:progress', { stage, message, ...extra });
    }
  };

  youtubeRunCancelled = false;
  const url = String(playlistUrl || urlAlias || '').trim();
  const started = Date.now();

  try {
    // `watch?v=` / youtu.be / embed → a single video. `playlist?list=` → a playlist. A
    // watch URL that also carries `list=` is treated as that single video.
    const singleId = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]{10,})/);
    const isPlaylist = !singleId && !!listMatch;

    if (!singleId && !listMatch) {
      const error = 'Unrecognized YouTube link. Paste a video (watch?v=…) or a playlist (playlist?list=…) URL.';
      send('error', error);
      return { success: false, error };
    }

    // ── 1. Resolve the playlist ────────────────────────────────────────────
    let videoIds = [];
    if (!isPlaylist) {
      videoIds = [singleId[1]];
      send('playlist-resolved', `Single video ${videoIds[0]}`, { current: 0, total: 1 });
    } else {
      send('fetching-playlist', 'Resolving playlist URL…');
      let html = '';
      try {
        html = await withTimeout(
          fetchYouTubePage(`https://www.youtube.com/playlist?list=${listMatch[1]}`),
          30000, 'Playlist fetch',
        );
      } catch (err) {
        send('error', err.message);
        return { success: false, error: `Could not fetch playlist: ${err.message}` };
      }
      const ids = new Set();
      const idRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
      let m;
      while ((m = idRegex.exec(html)) !== null) ids.add(m[1]);
      videoIds = [...ids].slice(0, 50);
      if (videoIds.length === 0) {
        const error = 'No videos found. The playlist may be private or empty.';
        send('error', error);
        return { success: false, error };
      }
      send('playlist-resolved', `${videoIds.length} videos`, { current: 0, total: videoIds.length });
    }

    // ── 2. Captions: parallel, and partial success is a success ────────────
    send('fetching-transcripts', 'Fetching captions…', { current: 0, total: videoIds.length });
    const { YoutubeTranscript } = loadYoutubeTranscript();
    const settled = await Promise.allSettled(
      videoIds.map((id) => withTimeout(YoutubeTranscript.fetchTranscript(id), 15000, `transcript ${id}`)),
    );
    const transcripts = [];
    settled.forEach((res, i) => {
      if (res.status !== 'fulfilled') return;
      const text = res.value.map((s) => s.text.trim()).join(' ').slice(0, 3500);
      if (text.length > 50) transcripts.push({ id: videoIds[i], text });
    });
    const skipped = videoIds.length - transcripts.length;
    send('transcripts-ready',
      `${transcripts.length} transcripts${skipped ? `, ${skipped} skipped` : ''}`,
      { current: transcripts.length, total: videoIds.length, skipped });

    if (transcripts.length === 0) {
      const error = 'No transcripts available. Captions may be disabled on all videos.';
      send('error', error);
      return { success: false, error };
    }

    // ── 3. One outline per video, then a single merge ──────────────────────
    // Sending every transcript in one call (up to 60k characters) exhausts R1's reasoning
    // budget and returns nothing usable; per-video keeps each call small, and lets one bad
    // video be skipped instead of failing the whole run.
    const apiKey = getDeepSeekKey();
    const perVideo = [];
    for (let i = 0; i < transcripts.length; i++) {
      if (youtubeRunCancelled) {
        send('error', 'Cancelled.');
        return { success: false, error: 'Cancelled.' };
      }
      send('generating-outline', `Video ${i + 1} of ${transcripts.length}`, { current: i + 1, total: transcripts.length });
      try {
        const outline = await withTimeout(callDeepSeekMain({
          apiKey,
          messages: [
            { role: 'system', content: YOUTUBE_VIDEO_SYSTEM },
            { role: 'user', content: `Video ${i + 1} of ${transcripts.length}:\n\n${transcripts[i].text}` },
          ],
          maxTokens: 8192,
        }), 120000, `outline for video ${i + 1}`);
        if (outline && outline.trim()) perVideo.push({ index: i + 1, outline: outline.trim() });
      } catch (err) {
        // One video failing must not lose the other eleven.
        console.warn(`[youtube] video ${i + 1} outline failed:`, err.message);
      }
    }
    if (perVideo.length === 0) {
      const error = 'Outline generation failed for every video. Try again, or use a shorter playlist.';
      send('error', error);
      return { success: false, error };
    }

    send('generating-outline', `Merging ${perVideo.length} sections…`, { current: perVideo.length, total: perVideo.length });
    const merged = await withTimeout(callDeepSeekMain({
      apiKey,
      messages: [
        { role: 'system', content: YOUTUBE_MERGE_SYSTEM },
        { role: 'user', content: perVideo.map((p) => `=== SECTION ${p.index} ===\n${p.outline}`).join('\n\n') },
      ],
      maxTokens: 8192,
    }), 120000, 'outline merge');
    if (!merged || !merged.trim()) {
      const error = 'The outline merge returned nothing. Try a shorter playlist.';
      send('error', error);
      return { success: false, error };
    }

    // ── 4. Save to the Vault ───────────────────────────────────────────────
    send('saving', 'Writing to Document Vault…');
    const outlinesDir = path.join(getBiannaLawDir(), 'Outlines');
    fs.mkdirSync(outlinesDir, { recursive: true });
    const year = new Date().getFullYear();
    const num = fs.readdirSync(outlinesDir).filter((f) => f.startsWith('Quimbee__Outline__')).length + 1;
    const fileName = `Quimbee__Outline__${num}__${year}.md`;
    const filePath = path.join(outlinesDir, fileName);
    const source = isPlaylist ? `Playlist: ${listMatch[1]}` : `Video: ${videoIds[0]}`;
    const header = `# Quimbee — Outline ${num} — ${year}\n\nGenerated: ${new Date().toLocaleString()}\n`
      + `Videos: ${transcripts.length} / ${videoIds.length} · ${source}\n\n---\n\n`;
    const artifact = header + merged;
    fs.writeFileSync(filePath, artifact, 'utf8');

    // Tell the Vault a new document exists so it can refresh without a manual pull.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('document-vault:new-file', { filePath, fileName });
    }
    send('done', 'Complete!', { filePath, fileName, outline: artifact, current: transcripts.length, total: videoIds.length });

    return {
      success: true,
      outlineText: artifact,
      fileName,
      filePath,
      videoCount: transcripts.length,
      totalFound: videoIds.length,
      urlType: isPlaylist ? 'playlist' : 'video',
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    // The handler as a whole is bounded. Previously a throw here - for example from
    // loadYoutubeTranscript, which sat outside any try - rejected the invoke and left the
    // renderer on "Processing…" forever. Now the renderer always gets a reason.
    console.error('[process-youtube-playlist]', err);
    const message = err.message || 'Playlist processing failed.';
    send('error', message);
    return { success: false, error: message };
  }
});


// ─── IPC: Pick & Read File (PDF / DOCX / TXT) ────────────────────────────────
ipcMain.handle('pick-and-read-file', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Attach Document',
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePaths.length) return { success: false, canceled: true };

  const filePath = filePaths[0];
  const fileName = path.basename(filePath);

  try {
    const text = await extractDocumentText(filePath);

    return { success: true, fileName, filePath, text };
  } catch (err) {
    console.error('[pick-and-read-file]', err);
    // `noText: true` tells the renderer to offer paste capture rather than an error.
    return { success: false, noText: /no selectable text/i.test(err.message), error: `Could not read file: ${err.message}` };
  }
});

// ─── IPC: Read a dropped/known path (no second file picker) ──────────────────
// The renderer resolves the real path of a dropped File via preload → getPathForFile,
// then calls this. Avoids the old behaviour where dropping a PDF re-opened a native
// picker, and guarantees the drop zone can fall back to paste capture on failure.
ipcMain.handle('read-file-text', async (_event, { filePath, maxChars } = {}) => {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'No file path supplied.' };
  }
  try {
    const text = await extractDocumentText(filePath, maxChars || 12000);
    return { success: true, fileName: path.basename(filePath), filePath, text };
  } catch (err) {
    console.error('[read-file-text]', err);
    return { success: false, noText: /no selectable text/i.test(err.message), error: err.message };
  }
});

// ─── IPC: Google Calendar Sync (OAuth Desktop Flow) ──────────────────────────
const GOOGLE_CLIENT_ID = '693600415930-h4iu5hv5p1r53i22c7ltatt6tlmsu3qr.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth2callback';

ipcMain.handle('sync-google-calendar', async (_event, eventsList) => {
  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

    let tokens = store.get('googleTokens');
    // Basic verification of token presence
    if (tokens && tokens.access_token) {
      oauth2Client.setCredentials(tokens);
    } else {
      // Begin OAuth loopback flow
      await new Promise((resolve, reject) => {
        const urlObj = require('url');
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar.events']
        });

        const server = http.createServer(async (req, res) => {
          try {
            if (req.url.indexOf('/oauth2callback') > -1) {
              const qs = new urlObj.URL(req.url, 'http://localhost:3000').searchParams;
              const code = qs.get('code');
              res.end('Authentication successful! You can close this tab and return to Senior Law Partner.');
              server.destroy();
              
              if (code) {
                const { tokens: newTokens } = await oauth2Client.getToken(code);
                oauth2Client.setCredentials(newTokens);
                store.set('googleTokens', newTokens);
                resolve();
              } else {
                reject(new Error('No authorization code returned.'));
              }
            }
          } catch (e) {
            reject(e);
          }
        });

        // Add server.destroy utility to sever all connections cleanly
        const connections = new Set();
        server.on('connection', (conn) => {
          connections.add(conn);
          conn.on('close', () => connections.delete(conn));
        });
        server.destroy = () => {
          server.close();
          for (const conn of connections) conn.destroy();
        };

        server.listen(3000, () => {
          shell.openExternal(authUrl);
        });
      });
    }

    // Now authenticated, insert events
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const results = [];
    for (const ev of eventsList) {
      if (!ev.date) continue;
      
      // Calculate end date (next day) for an all-day event
      const startDate = new Date(ev.date);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);
      const endStr = endDate.toISOString().split('T')[0];
      
      const res = await calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary: `📖 Reading: ${ev.caseName.substring(0, 50)}`,
          description: 'Law School Reading Reminder via Senior Law Partner',
          start: { date: ev.date }, 
          end: { date: endStr },
          reminders: {
            useDefault: false,
            // 10 hours before midnight = 2:00 PM the day prior
            overrides: [{ method: 'popup', minutes: 600 }]
          }
        }
      });
      results.push(res.data.htmlLink);
    }

    return { success: true, count: results.length };
  } catch (err) {
    console.error('[sync-google-calendar]', err);
    // If auth rejected, clear tokens to force re-login next time
    if (err.message && (err.message.toLowerCase().includes('invalid') || err.message.toLowerCase().includes('unauthorized'))) {
       store.delete('googleTokens');
    }
    return { success: false, error: err.message || 'Google Calendar sync failed.' };
  }
});

// ─── IPC: renderer boot signals ──────────────────────────────────────────────
// The renderer's half of the diagnostics at the top of this file. `on`, not `handle`:
// these are fire-and-forget reports, and nothing in the renderer should wait on a log
// write.
ipcMain.on('app:renderer-mounted', () => onRendererMounted());

ipcMain.on('app:boot-fault', (_event, payload) => {
  const kind   = payload && payload.kind   ? String(payload.kind)   : 'fault';
  const detail = payload && payload.detail ? String(payload.detail) : '(no detail)';
  bootLog('RENDERER FAULT [' + kind + '] ' + detail.replace(/\s+/g, ' ').slice(0, 1500));
});

// ─── Local Document Vault ────────────────────────────────────────────────────
// The Vault used to be Supabase-only, so a missing project, table or RLS policy meant an
// outline Bianna had just generated could not be saved anywhere: the insert failed and
// the UI said only "Save failed". Keeping her work must not depend on a network service
// being provisioned correctly, so the artifact is written to disk first and mirrored to
// Supabase as a bonus rather than as a precondition.
//
// Layout:  Documents/Bianna_Law/Vault/<slug>_<stamp>.html   the artifact itself
//          Documents/Bianna_Law/Vault/index.json            taggable metadata
const VAULT_DIRNAME = 'Vault';
const VAULT_INDEX   = 'index.json';

function getVaultDir() {
  const dir = path.join(getBiannaLawDir(), VAULT_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readVaultIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(getVaultDir(), VAULT_INDEX), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Absent or corrupt index: an empty list is the only safe reading, because the
    // artifacts on disk remain the source of truth and can be listed again.
    return [];
  }
}

function writeVaultIndex(records) {
  const file = path.join(getVaultDir(), VAULT_INDEX);
  // Write-then-rename so a crash mid-write cannot truncate the index and lose every tag.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Filesystem-safe, human-readable stem. Never returns an empty string. */
function slugify(value, fallback = 'outline') {
  const s = String(value || '').trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return s || fallback;
}

/** Sortable, filesystem-safe timestamp: 2026-09-25_17-46-06 */
function vaultStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Wrap a bare HTML fragment so it stands alone in a browser or a PDF renderer. */
function wrapHtmlFragment(html, title) {
  const safeTitle = String(title || 'Outline').replace(/[<>&]/g, '');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>' + safeTitle + '</title>' +
    '<style>body{font-family:Georgia,serif;line-height:1.55;margin:48px;color:#1a1a1a}' +
    'h1,h2,h3,h4{color:#546345}table{border-collapse:collapse}' +
    'td,th{border:1px solid #cccccc;padding:4px 8px}</style></head><body>' +
    html + '</body></html>';
}

ipcMain.handle('vault:save', (_event, { topic, subject, mode, tags, html } = {}) => {
  try {
    const clean = String(html || '').trim();
    if (!clean) return { success: false, error: 'Nothing to save: the outline is empty.' };

    const dir   = getVaultDir();
    const title = String(topic || 'Untitled').trim() || 'Untitled';
    const file  = slugify(title) + '_' + vaultStamp() + '.html';
    fs.writeFileSync(path.join(dir, file), wrapHtmlFragment(clean, title), 'utf8');

    const record = {
      id:         'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      topic:      title,
      subject:    String(subject || 'other'),
      mode:       String(mode || 'full_outline'),
      tags:       Array.isArray(tags) ? tags.map(String).slice(0, 24) : [],
      created_at: new Date().toISOString(),
      file,
      origin:     'local',
    };
    const records = readVaultIndex();
    records.unshift(record);
    writeVaultIndex(records);
    bootLog('vault: saved locally -> ' + file);
    return { success: true, record, dir };
  } catch (err) {
    console.error('[vault:save]', err);
    return { success: false, error: err.message || 'Could not write to the Vault folder.' };
  }
});

ipcMain.handle('vault:list', () => {
  try { return { success: true, records: readVaultIndex(), dir: getVaultDir() }; }
  catch (err) { return { success: false, error: err.message, records: [] }; }
});

ipcMain.handle('vault:read', (_event, { id } = {}) => {
  try {
    const record = readVaultIndex().find((r) => r.id === id);
    if (!record) return { success: false, error: 'That Vault item no longer exists.' };
    return { success: true, record, html: fs.readFileSync(path.join(getVaultDir(), record.file), 'utf8') };
  } catch (err) {
    return { success: false, error: err.message || 'Could not read that Vault item.' };
  }
});

ipcMain.handle('vault:update', (_event, { id, tags, topic } = {}) => {
  try {
    const records = readVaultIndex();
    const record  = records.find((r) => r.id === id);
    if (!record) return { success: false, error: 'That Vault item no longer exists.' };
    // Only metadata moves. The artifact is never rewritten, so re-tagging cannot damage
    // a saved document.
    if (Array.isArray(tags)) record.tags = tags.map(String).slice(0, 24);
    if (typeof topic === 'string' && topic.trim()) record.topic = topic.trim();
    record.updated_at = new Date().toISOString();
    writeVaultIndex(records);
    return { success: true, record };
  } catch (err) {
    return { success: false, error: err.message || 'Could not update that Vault item.' };
  }
});

ipcMain.handle('vault:delete', (_event, { id } = {}) => {
  try {
    const records = readVaultIndex();
    const record  = records.find((r) => r.id === id);
    if (!record) return { success: false, error: 'That Vault item no longer exists.' };
    try { fs.unlinkSync(path.join(getVaultDir(), record.file)); } catch { /* already gone */ }
    writeVaultIndex(records.filter((r) => r.id !== id));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Could not delete that Vault item.' };
  }
});

ipcMain.handle('vault:open-folder', () => {
  shell.openPath(getVaultDir());
  return { success: true };
});

// ─── IPC: Export an outline to Word / PDF / HTML / Markdown ──────────────────
// "Save it to a folder I choose" is a first-class outcome, not a consolation prize: a
// student printing, emailing or editing her own work needs a real file in a real folder.
// Word and PDF are both offered because which one is useful depends on what she is doing
// with it, and she is the only one who knows that.
const EXPORT_FORMATS = {
  docx: { name: 'Microsoft Word', ext: 'docx' },
  pdf:  { name: 'PDF',            ext: 'pdf'  },
  html: { name: 'Web page',       ext: 'html' },
  md:   { name: 'Markdown',       ext: 'md'   },
};

/** Flatten an HTML fragment to text lines, preserving the block structure. */
function htmlToLines(html) {
  const lines = String(html || '')
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|table)\s*>/gi, '\n')
    .replace(/<\s*h[1-6][^>]*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  // Collapse runs of blank lines to at most one, without dropping real paragraphs.
  return lines.filter((l, i) => l.trim() || (i > 0 && lines[i - 1].trim()));
}

/** Word: real .docx, using the same `docx` dependency the IRAC generator already uses. */
async function writeDocx(filePath, { title, subtitle, html }) {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer } = require('docx');
  const children = [new Paragraph({
    heading:  HeadingLevel.TITLE,
    children: [new TextRun({ text: String(title || 'Outline'), bold: true, size: 32 })],
  })];
  if (subtitle) {
    children.push(new Paragraph({
      spacing:  { after: 260 },
      children: [new TextRun({ text: subtitle, italics: true, size: 20, color: '6B7280' })],
    }));
  }
  for (const line of htmlToLines(html)) {
    children.push(new Paragraph({
      spacing:  { after: 90 },
      children: [new TextRun({ text: line || '', size: 22 })],
    }));
  }
  fs.writeFileSync(filePath, await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

/** PDF: Chromium's own print pipeline, so wrapping and fonts match what she saw on screen. */
async function writePdf(filePath, { title, html }) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent(wrapHtmlFragment(html, title)));
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, pdf);
  } finally {
    // Always destroy: an orphaned hidden window keeps the app alive after the last
    // visible window closes.
    win.destroy();
  }
}

ipcMain.handle('document:export', async (_event, {
  topic, subject, mode, html, format = 'docx', filePath: presetPath,
} = {}) => {
  try {
    const clean = String(html || '').trim();
    if (!clean) return { success: false, error: 'Nothing to export: the outline is empty.' };

    const fmt  = EXPORT_FORMATS[format] ? format : 'docx';
    const meta = EXPORT_FORMATS[fmt];
    const title = String(topic || 'Untitled').trim() || 'Untitled';

    let target = presetPath;
    if (!target) {
      // The native dialog is the point of this feature, not an afterthought: it is the
      // only way she can put the file in the folder she actually wants, which is how
      // everything else she does with a Mac works.
      const chosen = await dialog.showSaveDialog(mainWindow, {
        title:       'Save outline',
        defaultPath: path.join(app.getPath('documents'), slugify(title) + '.' + meta.ext),
        filters:     [{ name: meta.name, extensions: [meta.ext] }],
      });
      if (chosen.canceled || !chosen.filePath) return { success: false, canceled: true };
      target = chosen.filePath;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const subtitle = [String(subject || ''), String(mode || '')].filter(Boolean).join('  •  ');

    if (fmt === 'docx')      await writeDocx(target, { title, subtitle, html: clean });
    else if (fmt === 'pdf')  await writePdf(target, { title, html: clean });
    else if (fmt === 'html') fs.writeFileSync(target, wrapHtmlFragment(clean, title), 'utf8');
    else                     fs.writeFileSync(target,
                               '# ' + title + '\n\n' + htmlToLines(clean).join('\n') + '\n', 'utf8');

    shell.showItemInFolder(target);
    bootLog('document:export -> ' + target);
    return { success: true, filePath: target, format: fmt };
  } catch (err) {
    console.error('[document:export]', err);
    return { success: false, error: err.message || 'Export failed.' };
  }
});

// ─── Quit guard ──────────────────────────────────────────────────────────────
// A generated outline can be tens of thousands of tokens of work. Closing the window
// used to discard it without a word. The renderer reports whether anything is unsaved;
// the first quit or close is intercepted and handed back for her to resolve.
ipcMain.on('app:set-unsaved', (_event, flag) => { hasUnsavedOutline = !!flag; });

ipcMain.handle('app:exit-now', () => {
  exitConfirmed = true;
  app.quit();
  return { success: true };
});

app.on('before-quit', (event) => {
  if (exitConfirmed || !hasUnsavedOutline) return;
  if (!mainWindow || mainWindow.isDestroyed()) { exitConfirmed = true; return; }
  event.preventDefault();
  bootLog('quit intercepted: an unsaved outline is open');
  mainWindow.webContents.send('app:unsaved-exit');
});



