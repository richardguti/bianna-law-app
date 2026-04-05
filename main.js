/**
 * main.js — Senior Law Partner
 * Electron main process: IPC handlers, Claude API, RAG, document generation.
 */

'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const Store  = require('electron-store');

// ─── Auto Updater ─────────────────────────────────────────────────────────────
let autoUpdater = null;
try {
  const updaterModule = require('electron-updater');
  autoUpdater = updaterModule.autoUpdater;
  const log = require('electron-log');
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  // Disable autoDownload on macOS because unsigned ZIP updates fail
  autoUpdater.autoDownload = process.platform !== 'darwin';
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';
} catch (e) {
  console.warn('[updater] electron-updater failed to load:', e.message);
}

// ─── Persistent Store ────────────────────────────────────────────────────────
const store = new Store({
  encryptionKey: 'slp-bianna-secure-2024',
});

// ─── RAG Module ──────────────────────────────────────────────────────────────
const { getRelevantContext } = require('./rag');

// ─── Predefined Claude Skills ─────────────────────────────────────────────────
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

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
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

  mainWindow.loadFile(path.join(__dirname, 'dist-react', 'index.html'));

  // DevTools: open in dev or --devtools flag; Cmd+Opt+I / F12 toggles in all builds
  if (!app.isPackaged || process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools();
  }

  // Allow toggling DevTools with Cmd+Option+I (Mac) or F12 (all) in packaged builds
  const { globalShortcut } = require('electron');
  globalShortcut.register('CommandOrControl+Alt+I', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register('F12', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  ensureBiannaLawDir();
  createWindow();

  // ── OTA Updates ──────────────────────────────────────────────────────────
  if (autoUpdater) {
    if (process.platform === 'darwin') {
      // macOS: Notify about update and redirect to GitHub Releases
      autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available — Senior Law Partner',
          message: `Version ${info.version} is available!`,
          detail: 'Because you are using macOS, you must download the update manually using Safari.\n\nClick "Download Update" to open the latest release page.',
          buttons: ['Download Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
          icon: path.join(__dirname, 'assets', 'icon.png'),
        }).then(({ response }) => {
          if (response === 0) {
            shell.openExternal('https://github.com/richardguti/bianna-law-app/releases/latest');
          }
        });
      });
    } else {
      // Windows / Linux: standard background download and install
      autoUpdater.on('update-downloaded', (info) => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Ready — Senior Law Partner',
          message: `Version ${info.version} has been downloaded and is ready to install.`,
          detail: 'Click "Restart & Update" to apply the update now, or "Later" to install on next launch.',
          buttons: ['Restart & Update', 'Later'],
          defaultId: 0,
          icon: path.join(__dirname, 'assets', 'icon.png'),
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(false, true);
        });
      });
    }

    autoUpdater.on('error', (err) => {
      console.error('[updater] error:', err);
    });

    // Check 8 seconds after launch (let app finish loading), then every 4 hours
    if (app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 8000);
      setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── File System: Documents/Bianna_Law/ ──────────────────────────────────────
function getBiannaLawDir() {
  return path.join(app.getPath('documents'), 'Bianna_Law');
}

function ensureBiannaLawDir() {
  const dir = getBiannaLawDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('[fs] Created Bianna_Law directory:', dir);
  }
}

// ─── IPC: API Key Management ──────────────────────────────────────────────────
ipcMain.handle('api-key-exists', () => !!(store.get('anthropicApiKey')));

ipcMain.handle('api-key-save', (_event, key) => {
  if (!key || typeof key !== 'string' || !key.startsWith('sk-')) {
    return { success: false, error: 'Invalid API key format. Key must start with "sk-".' };
  }
  store.set('anthropicApiKey', key.trim());
  return { success: true };
});

ipcMain.handle('api-key-clear', () => {
  store.delete('anthropicApiKey');
  return { success: true };
});

// ─── AI Tools Initialization ─────────────────────────────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = 'AIzaSyCuld2555PxD65YVIcTVJNPwKdXYVTKJrE';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const { Supermemory } = require('supermemory');
// Fallback key to prevent instant crash before user configs it
const smKey = store.get('supermemoryApiKey') || 'dummy-key-for-now';
const supermemory = new Supermemory({ apiKey: smKey });

// ─── IPC: AI Chat (Dual Model + Supermemory + RAG) ─────────────────────────
ipcMain.handle('ai-prompt-send', async (_event, { prompt, systemPrompt, mode, modelPreference = 'claude' }) => {
  const apiKey = (store.get('anthropicApiKey'));
  
  try {
    let memoryContext = '';
    try {
      // 1. Retrieve persistent memory from Supermemory
      const memories = await supermemory.search({ query: prompt });
      if (memories && memories.length > 0) {
        memoryContext = '\n\nSUPERMEMORY (Persistent History):\n' + memories.map(m => m.content || m.text).join('\n');
      }
      // 2. Add the current interaction to Supermemory immediately
      await supermemory.addMemory({ content: prompt, tags: ['chat', mode || 'general'] });
    } catch(smErr) {
      console.warn('[Supermemory skipped]', smErr.message);
    }

    // Phase 4: Retrieve relevant legal context via local RAG
    const ragContext = getRelevantContext(prompt, 3);
    const ragBlock   = ragContext
      ? `\n\nRELEVANT LEGAL CONTEXT (from local corpus — use this to ground your answer):\n\n${ragContext}`
      : '';

    const fullSystem = (systemPrompt || buildDefaultSystem(mode)) + memoryContext + ragBlock;

    let responseText = '';

    if (modelPreference === 'gemini') {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro', systemInstruction: fullSystem });
      const result = await model.generateContent(prompt);
      responseText = result.response.text();
    } else {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });
      const message = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     fullSystem,
        messages:   [{ role: 'user', content: prompt }],
      });
      responseText = message.content[0].text;
    }

    return { success: true, response: responseText };
  } catch (err) {
    console.error('[AI Chat]', err);
    return { success: false, error: err.message || 'Unknown error calling AI API.' };
  }
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

// ─── IPC: Document Generation (IRAC .docx) ───────────────────────────────────
ipcMain.handle('generate-document', async (_event, { caseText, caseName }) => {
  const apiKey = (store.get('anthropicApiKey'));
  if (!apiKey) {
    return { success: false, error: 'No API key configured. Click Settings to add your Anthropic API key.' };
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });

    // Step 1: Ask Claude to produce a structured IRAC analysis as JSON
    const analysisMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are a meticulous legal analyst. Analyze the provided case using the IRAC framework.
Respond ONLY with a valid JSON object (no markdown fences) with exactly these fields:
{
  "issue":       "The precise legal question(s) presented by this case.",
  "rule":        "The applicable legal rules, statutes, constitutional provisions, or binding precedents.",
  "application": "Step-by-step application of the rules to the specific facts of this case.",
  "conclusion":  "The court's holding or the logical conclusion of the analysis.",
  "keyFacts":    "The most important facts that determined the outcome.",
  "significance":"Why this case matters — its lasting legal significance or doctrinal contribution."
}`,
      messages: [{
        role:    'user',
        content: `Case Name: ${caseName}\n\nCase Text / Description:\n${caseText}`,
      }],
    });

    let irac;
    try {
      const raw = analysisMsg.content[0].text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      irac = JSON.parse(raw);
    } catch {
      // Fallback: put full response in application field
      irac = {
        issue:       'See full analysis below.',
        rule:        '',
        application: analysisMsg.content[0].text,
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
  const { listSources } = require('./rag');
  return listSources();
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
//   1. Claude extracts structured week/topic/reading data from syllabus text
//   2. Creates a rich Notion page under the main workspace page with:
//      - Color-coded priority sections (🔴 High / 🟡 Medium / 🟢 Low)
//      - Per-week reading tables with volume, difficulty, and due date columns
ipcMain.handle('organize-syllabus', async (_event, { syllabusText, courseName }) => {
  const apiKey = (store.get('anthropicApiKey'));
  if (!apiKey) return { success: false, error: 'No API key configured.' };

  const notionKey = (store.get('notionApiKey') || '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');
  if (!notionKey) return { success: false, error: 'No Notion key configured. Add it in Settings.' };

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey });

    // Step 1: Ask Claude to extract a structured syllabus JSON
    const extractMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a legal study organizer. Extract a structured study plan from the provided law school syllabus.
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
      messages: [{ role: 'user', content: `Course: ${courseName}\n\nSyllabus:\n${syllabusText.slice(0, 8000)}` }],
    });

    let syllabus;
    try {
      const raw = extractMsg.content[0].text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
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

// ─── IPC: YouTube Transcript Extraction ──────────────────────────────────────
ipcMain.handle('extract-youtube-transcript', async (_event, videoUrl) => {
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
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

// ─── OpenClaw Integration ─────────────────────────────────────────────────────
// OpenClaw is a local AI gateway (port 18789) with persistent memory, skills,
// and an OpenAI-compatible chat completions API. When running it automatically
// injects past study context into every conversation.

const net   = require('net');
const http  = require('http');
const https = require('https');
const { spawn: spawnProc } = require('child_process');

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

const OPENCLAW_PORT = 18789;

function isOpenClawInstalled() {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec('openclaw --version', { shell: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

function isOpenClawRunning() {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.setTimeout(1500);
    client.on('connect', () => { client.destroy(); resolve(true); });
    client.on('error', () => resolve(false));
    client.on('timeout', () => { client.destroy(); resolve(false); });
    client.connect(OPENCLAW_PORT, '127.0.0.1');
  });
}

// Check installed + gateway running status
ipcMain.handle('openclaw:status', async () => {
  const installed = await isOpenClawInstalled();
  const running   = await isOpenClawRunning();
  return { installed, running };
});

// Run the official install script — streams progress back to renderer
ipcMain.handle('openclaw:install', () => {
  return new Promise((resolve) => {
    const isMac = process.platform === 'darwin';
    let child;
    if (isMac) {
      // macOS: try shell installer, fall back to npm install -g
      child = spawnProc(
        '/bin/bash',
        ['-c', 'curl -fsSL https://openclaw.ai/install.sh | bash || npm install -g openclaw'],
        { shell: false }
      );
    } else {
      child = spawnProc(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'irm https://openclaw.ai/install.ps1 | iex'],
        { shell: false, windowsHide: false }
      );
    }
    let output = '';
    const onData = (d) => {
      const chunk = d.toString();
      output += chunk;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('openclaw:install-progress', chunk);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', (code) => resolve({ success: code === 0, output, exitCode: code }));
    child.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// OpenClaw gateway auth token — matches ~/.openclaw/config.json5
const OPENCLAW_GATEWAY_TOKEN = 'slp-bianna-gateway-2026';

// Start the OpenClaw gateway service in the background.
// Augments PATH with npm global bin (common install location for openclaw CLI)
// and retries with npx if the direct command is not found.
ipcMain.handle('openclaw:start-gateway', () => {
  return new Promise(async (resolve) => {
    const os = require('os');

    // Build an augmented PATH that includes the most likely npm global bin dirs (cross-platform)
    const isMac = process.platform === 'darwin';
    const sep   = isMac ? ':' : ';';
    const npmGlobalBin = isMac
      ? ['/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.npm-global', 'bin')]
      : [path.join(os.homedir(), 'AppData', 'Roaming', 'npm')];
    const augmentedEnv = {
      ...process.env,
      PATH: [process.env.PATH, ...npmGlobalBin].filter(Boolean).join(sep),
    };

    function trySpawn(cmd, args) {
      return new Promise((res) => {
        const child = spawnProc(cmd, args, {
          shell: true, detached: true, stdio: 'ignore', env: augmentedEnv,
        });
        child.on('error', () => res(false));
        child.unref();
        res(true);
      });
    }

    // 1st attempt: direct `openclaw gateway` (with our fixed token so the webview can auto-connect)
    await trySpawn('openclaw', ['gateway', '--port', String(OPENCLAW_PORT), '--token', OPENCLAW_GATEWAY_TOKEN]);

    // Poll every 2 s for up to 30 s
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const running = await isOpenClawRunning();
      if (running) { resolve({ success: true }); return; }

      // After 6 s of no response, try via npx as fallback
      if (i === 2) {
        await trySpawn('npx', ['--yes', 'openclaw', 'gateway', '--port', String(OPENCLAW_PORT), '--token', OPENCLAW_GATEWAY_TOKEN]);
      }
    }

    resolve({ success: false, error: 'Gateway did not respond within 30 seconds.' });
  });
});

// Return the live dashboard URL (contains the real gateway token in the hash fragment).
// Runs `openclaw dashboard --no-open` and parses the URL from stdout.
ipcMain.handle('openclaw:get-dashboard-url', () => {
  const { exec } = require('child_process');
  const os = require('os');
  const isMacDash = process.platform === 'darwin';
  const macBins   = ['/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.npm-global', 'bin')];
  const winBin    = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const env = {
    ...process.env,
    PATH: [process.env.PATH, ...(isMacDash ? macBins : [winBin])].filter(Boolean).join(isMacDash ? ':' : ';'),
  };
  return new Promise((resolve) => {
    exec('openclaw dashboard --no-open', { env, timeout: 8000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      // stdout: "Dashboard URL: http://127.0.0.1:18789/#token=TOKEN\nCopied to clipboard."
      const match = stdout.match(/Dashboard URL:\s*(https?:\/\/\S+)/i);
      resolve(match ? match[1].trim() : null);
    });
  });
});

// Open a new visible terminal window running the OpenClaw gateway interactively.
// The user only needs to type y / n if prompted and press Enter.
ipcMain.handle('openclaw:open-terminal', () => {
  const { exec } = require('child_process');
  if (process.platform === 'darwin') {
    exec(`osascript -e 'tell application "Terminal" to do script "openclaw gateway run --token ${OPENCLAW_GATEWAY_TOKEN}"'`);
  } else {
    exec(`start cmd /k "openclaw gateway run --token ${OPENCLAW_GATEWAY_TOKEN}"`, { shell: true });
  }
  return { success: true };
});

// Forward chat messages to the OpenClaw gateway (OpenAI-compatible API)
// The gateway automatically injects persistent memory context into every request.
ipcMain.handle('openclaw:chat', async (_event, { messages, system }) => {
  const body = JSON.stringify({
    model: 'openclaw:main',
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
    stream: false,
  });

  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: OPENCLAW_PORT,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      },
      timeout: 45000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.message?.content ?? '';
          if (!text) throw new Error('Empty gateway response');
          resolve({ success: true, response: text });
        } catch (e) {
          resolve({ success: false, error: `Gateway parse error: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: `Gateway unreachable: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Gateway timed out.' }); });
    req.write(body);
    req.end();
  });
});

// Write directly to OpenClaw memory Markdown files — works even when gateway is offline.
// type='daily'    → ~/.openclaw/workspace/memory/YYYY-MM-DD.md  (session notes, quiz results)
// type='longterm' → ~/.openclaw/workspace/MEMORY.md             (course facts, professor quirks)
ipcMain.handle('openclaw:memory-write', async (_event, { content, type = 'daily', heading }) => {
  const os = require('os');
  const workspaceDir = path.join(os.homedir(), '.openclaw', 'workspace');
  try {
    fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });
    const filePath = type === 'longterm'
      ? path.join(workspaceDir, 'MEMORY.md')
      : path.join(workspaceDir, 'memory', `${new Date().toISOString().slice(0, 10)}.md`);

    const time  = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const label = heading ? `### ${heading} (${time})` : `### ${time}`;
    fs.appendFileSync(filePath, `\n${label}\n\n${content}\n`, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Search OpenClaw memory via the gateway tools/invoke API
ipcMain.handle('openclaw:memory-search', async (_event, { query }) => {
  const body = JSON.stringify({ tool: 'memory_search', args: { query }, sessionKey: 'main' });
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: OPENCLAW_PORT,
      path: '/tools/invoke',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ success: true, results: JSON.parse(data) }); }
        catch (e) { resolve({ success: false, error: 'Parse error' }); }
      });
    });
    req.on('error', () => resolve({ success: false, error: 'Gateway not running' }));
    req.write(body);
    req.end();
  });
});

// ─── IPC: App Diagnostics (for the Troubleshoot modal) ───────────────────────
// Collects the full system state so the renderer can display it and ask Claude
// to analyse what's wrong and suggest/apply fixes.
// Open a URL in the user's default browser (used for Google/Apple Calendar export)
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('app:diagnostics', async () => {
  const os = require('os');
  const installed = await isOpenClawInstalled();
  const running   = await isOpenClawRunning();

  // Check file counts in Bianna_Law dir
  const biannaDir = getBiannaLawDir();
  let fileCount = 0;
  try {
    fileCount = fs.readdirSync(biannaDir).length;
  } catch { /* dir not yet created */ }

  return {
    appVersion:       app.getVersion(),
    platform:         process.platform,
    nodeVersion:      process.version,
    isPackaged:       app.isPackaged,
    apiKeyPresent:    !!(store.get('anthropicApiKey')),
    notionKeyPresent: !!(store.get('notionApiKey')    || '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'),
    openClaw: { installed, running, port: OPENCLAW_PORT },
    biannaDir,
    biannaFileCount:  fileCount,
    homedir:          os.homedir(),
    freeMemMb:        Math.round(os.freemem() / 1024 / 1024),
  };
});

// ─── IPC: Scan & Auto-Sort Legal Files ───────────────────────────────────────
// Opens a native folder picker, walks files recursively, uses Claude to classify
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

  // Walk directory recursively — cap at 150 files to keep Claude call fast
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

  // Read a short text snippet from plaintext files to give Claude context
  const fileInfos = collected.map((f, i) => {
    let snippet = '';
    try {
      if (f.ext === '.txt' || f.ext === '.md') {
        snippet = fs.readFileSync(f.fullPath, 'utf8').slice(0, 350).replace(/\s+/g, ' ');
      }
    } catch { /* skip */ }
    return { index: i + 1, name: f.name, fullPath: f.fullPath, snippet };
  });

  // Ask Claude to classify all files in one shot
  const apiKey = store.get('anthropicApiKey');
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey });

    const fileList = fileInfos.map(f =>
      `${f.index}. "${f.name}"${f.snippet ? `\n   Hint: ${f.snippet.slice(0, 200)}` : ''}`
    ).join('\n\n');

    const classifyMsg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a law school file organizer for a 1L student. Classify each numbered file.
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
      messages: [{ role: 'user', content: `Classify these ${fileInfos.length} files from "${scanPath}":\n\n${fileList}` }],
    });

    const raw        = classifyMsg.content[0].text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
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

    return { success: true, courses, documents, total: fileInfos.length, scanPath };
  } catch (err) {
    console.error('[scan-legal-files]', err);
    return { success: false, error: err.message };
  }
});

// ─── IPC: YouTube Playlist → Outline ─────────────────────────────────────────
// Fetches all video transcripts from a playlist, generates one law-school outline
// with Claude, saves it to Documents/Bianna_Law/Outlines/, and streams progress.
ipcMain.handle('process-youtube-playlist', async (_event, { playlistUrl }) => {
  function progress(step, current, total, done) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playlist:progress', { step, current, total: total || 0, done: !!done });
    }
  }

  // 1. Extract playlist ID
  const listMatch = (playlistUrl || '').match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (!listMatch) return { success: false, error: 'No playlist ID found in URL.' };
  const playlistId = listMatch[1];

  // 2. Fetch playlist page and extract video IDs
  progress('Fetching playlist…', 0, 0);
  let html = '';
  try {
    html = await fetchYouTubePage(`https://www.youtube.com/playlist?list=${playlistId}`);
  } catch (err) {
    return { success: false, error: `Could not fetch playlist: ${err.message}` };
  }

  // Extract unique 11-char video IDs from YouTube's embedded JSON
  const idRegex   = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
  const videoIdSet = new Set();
  let m;
  while ((m = idRegex.exec(html)) !== null) videoIdSet.add(m[1]);

  const videoIds = [...videoIdSet];
  if (videoIds.length === 0) {
    return { success: false, error: 'No videos found. The playlist may be private or empty.' };
  }

  // 3. Collect transcripts (up to 50 videos, 3 s gap between requests)
  const { YoutubeTranscript } = require('youtube-transcript');
  const transcripts = [];
  const limit = Math.min(videoIds.length, 50);

  for (let i = 0; i < limit; i++) {
    progress(`Transcript ${i + 1} / ${limit}`, i + 1, limit);
    try {
      const segs = await Promise.race([
        YoutubeTranscript.fetchTranscript(videoIds[i]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      const text = segs.map((s) => s.text.trim()).join(' ').slice(0, 3500);
      if (text.length > 50) transcripts.push({ id: videoIds[i], text });
    } catch { /* skip videos without transcripts */ }

    if (i < limit - 1) await new Promise((r) => setTimeout(r, 400));
  }

  if (transcripts.length === 0) {
    return { success: false, error: 'No transcripts available in this playlist.' };
  }

  // 4. Generate outline with Claude
  progress('Generating outline with Claude…', transcripts.length, transcripts.length);
  const apiKey = store.get('anthropicApiKey');
  try {
    const Anthropic  = require('@anthropic-ai/sdk');
    const client     = new Anthropic.default({ apiKey });
    const combined   = transcripts.map((t, i) => `=== VIDEO ${i + 1} ===\n${t.text}`).join('\n\n');

    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8192,
      system: `You are Bianna's Senior Law Partner AI. Generate a comprehensive, hierarchical law school outline from the provided video transcripts using the Bia 4-tier format:

I.  MAJOR DOCTRINE
  A.  Sub-doctrine / Rule
    1.  Element or test
      a.  Exception / detail

For each case discussed, include a compact IRAC. Group content by legal topic, not video order. Label professor-highlighted cases with ★.`,
      messages: [{ role: 'user', content: `Generate a comprehensive law school outline from these ${transcripts.length} transcripts (playlist: ${playlistId}):\n\n${combined.slice(0, 60000)}` }],
    });

    const outlineText = msg.content[0].text;

    // 5. Save to Documents/Bianna_Law/Outlines/
    const biannaDir   = getBiannaLawDir();
    const outlinesDir = path.join(biannaDir, 'Outlines');
    fs.mkdirSync(outlinesDir, { recursive: true });

    const year     = new Date().getFullYear();
    const existing = fs.readdirSync(outlinesDir).filter((f) => f.startsWith('Quimbee__Outline__')).length;
    const num      = existing + 1;
    const fileName = `Quimbee__Outline__${num}__${year}.md`;
    const filePath = path.join(outlinesDir, fileName);

    const header   = `# Quimbee — Outline ${num} — ${year}\n\nGenerated: ${new Date().toLocaleString()}\nVideos: ${transcripts.length} / ${videoIds.length} · Playlist: ${playlistId}\n\n---\n\n`;
    fs.writeFileSync(filePath, header + outlineText, 'utf8');

    progress('Complete!', transcripts.length, transcripts.length, true);
    return { success: true, outlineText: header + outlineText, fileName, filePath, videoCount: transcripts.length, totalFound: videoIds.length };
  } catch (err) {
    console.error('[process-youtube-playlist]', err);
    return { success: false, error: err.message };
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
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  try {
    let text = '';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      text = data.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else {
      // .txt, .md, and any other text-based file
      text = fs.readFileSync(filePath, 'utf8');
    }

    // Trim to a reasonable length to avoid overwhelming the context window
    const MAX_CHARS = 12000;
    const trimmed = text.length > MAX_CHARS
      ? text.slice(0, MAX_CHARS) + `\n\n[… document truncated at ${MAX_CHARS} characters]`
      : text;

    return { success: true, fileName, text: trimmed };
  } catch (err) {
    console.error('[pick-and-read-file]', err);
    return { success: false, error: `Could not read file: ${err.message}` };
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
