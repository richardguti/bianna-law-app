/**
 * renderer.js — Frontend logic for Senior Law Partner
 *
 * All communication with the Node/Electron backend goes through
 * window.seniorPartner (exposed by preload.js via contextBridge).
 * No direct Node or Electron APIs are used here.
 */

'use strict';

// ─── DOM References ──────────────────────────────────────────────────────────
const apiStatusBadge    = document.getElementById('api-status');
const notionStatusBadge = document.getElementById('notion-status');
const btnSettings       = document.getElementById('btn-settings');

// Settings Modal
const modalOverlay      = document.getElementById('modal-overlay');
const modalClose        = document.getElementById('modal-close');
const apiKeyInput       = document.getElementById('api-key-input');
const btnToggleKey      = document.getElementById('btn-toggle-key');
const btnKeySave        = document.getElementById('btn-key-save');
const btnKeyClear       = document.getElementById('btn-key-clear');
const apiKeyStatus      = document.getElementById('api-key-status');
const notionKeyInput    = document.getElementById('notion-key-input');
const btnToggleNotionKey = document.getElementById('btn-toggle-notion-key');
const notionKeyStatus   = document.getElementById('notion-key-status');

// Chat
const chatContainer   = document.getElementById('chat-container');
const chatInput       = document.getElementById('chat-input');
const btnSend         = document.getElementById('btn-send');

// Outline Exporter
const outlineInput    = document.getElementById('outline-input');
const caseNameInput   = document.getElementById('case-name-input');
const btnGenerate     = document.getElementById('btn-generate');

// Difficulty Toggle
const difficultyBtns  = document.querySelectorAll('.btn--difficulty');

// Webview / URL bar
const urlInput          = document.getElementById('url-input');
const btnGo             = document.getElementById('btn-go');
const btnClearWebview   = document.getElementById('btn-clear-webview');
const lawWebview        = document.getElementById('law-webview');
const transcriptBox     = document.getElementById('transcript-box');
const btnSendTranscript = document.getElementById('btn-send-transcript');
const btnStartQuiz      = document.getElementById('btn-start-quiz');

// File attachment
const btnAttach           = document.getElementById('btn-attach');
const attachedFileBar     = document.getElementById('attached-file-bar');
const attachedFileName    = document.getElementById('attached-file-name');
const btnRemoveAttachment = document.getElementById('btn-remove-attachment');

// Syllabus Organizer
const btnOrganizeSyllabus = document.getElementById('btn-organize-syllabus');

// Sidebar
const sidebar           = document.getElementById('sidebar');
const sidebarToggle     = document.getElementById('sidebar-toggle');
const sidebarFileList   = document.getElementById('sidebar-file-list');
const btnRefreshFiles   = document.getElementById('btn-refresh-files');
const btnOpenFolder     = document.getElementById('btn-open-folder');

// Quiz overlay
const quizOverlay       = document.getElementById('quiz-overlay');
const quizQuestion      = document.getElementById('quiz-question');
const quizOptions       = document.getElementById('quiz-options');
const quizAnswer        = document.getElementById('quiz-answer');
const quizFeedback      = document.getElementById('quiz-feedback');
const quizProgress      = document.getElementById('quiz-progress');
const quizScoreDisplay  = document.getElementById('quiz-score-display');
const quizTopicLabel    = document.getElementById('quiz-topic-label');
const btnQuizSubmit     = document.getElementById('btn-quiz-submit');
const btnQuizNext       = document.getElementById('btn-quiz-next');
const btnQuizFinish     = document.getElementById('btn-quiz-finish');
const btnQuizClose      = document.getElementById('btn-quiz-close');

// ─── State ───────────────────────────────────────────────────────────────────
let currentDifficulty  = 'easy';
let isAwaitingResponse = false;
let attachedFile       = null; // { fileName, text }
let sidebarOpen        = true;

// Quiz state
let quizQuestions  = [];
let quizIndex      = 0;
let quizScore      = 0;
let quizWrong      = []; // array of { question, userAnswer, modelAnswer }
let quizTopic      = '';

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([checkApiKeyStatus(), checkNotionStatus()]);

  const exists = await window.seniorPartner.apiKeyExists();
  if (!exists) openModal();

  window.seniorPartner.on('show-settings-modal', openModal);
  await refreshSidebar();
}

// ─── API Key Status ──────────────────────────────────────────────────────────
async function checkApiKeyStatus() {
  try {
    const exists = await window.seniorPartner.apiKeyExists();
    apiStatusBadge.textContent = exists ? 'API: Active' : 'No API Key';
    apiStatusBadge.className   = `status-badge ${exists ? 'status-badge--ok' : 'status-badge--missing'}`;
  } catch {
    apiStatusBadge.textContent = 'Error';
    apiStatusBadge.className   = 'status-badge status-badge--missing';
  }
}

async function checkNotionStatus() {
  try {
    const exists = await window.seniorPartner.notionKeyExists();
    notionStatusBadge.textContent = exists ? 'Notion: Active' : 'Notion: Off';
    notionStatusBadge.className   = `status-badge ${exists ? 'status-badge--notion-ok' : 'status-badge--notion-missing'}`;
  } catch {
    notionStatusBadge.textContent = 'Notion: Off';
    notionStatusBadge.className   = 'status-badge status-badge--notion-missing';
  }
}

// ─── Settings Modal ──────────────────────────────────────────────────────────
function openModal() {
  apiKeyInput.value    = '';
  notionKeyInput.value = '';
  apiKeyStatus.textContent    = '';
  notionKeyStatus.textContent = '';
  apiKeyStatus.className    = 'form-status';
  notionKeyStatus.className = 'form-status';
  modalOverlay.hidden = false;
  apiKeyInput.focus();
}

function closeModal() {
  modalOverlay.hidden = true;
}

btnSettings.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Show/hide API key
btnToggleKey.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  btnToggleKey.textContent = isPassword ? '🙈' : '👁';
});

// Save both keys
btnKeySave.addEventListener('click', async () => {
  const anthropicKey = apiKeyInput.value.trim();
  const notionKey    = notionKeyInput.value.trim();

  if (!anthropicKey && !notionKey) {
    setKeyStatus('Enter at least one key to save.', 'error');
    return;
  }

  btnKeySave.disabled    = true;
  btnKeySave.textContent = 'Saving…';

  try {
    if (anthropicKey) {
      const r = await window.seniorPartner.apiKeySave(anthropicKey);
      if (r.success) {
        setKeyStatus('Anthropic key saved.', 'success');
        apiKeyInput.value = '';
      } else {
        setKeyStatus(r.error || 'Failed to save Anthropic key.', 'error');
      }
    }
    if (notionKey) {
      const r = await window.seniorPartner.notionKeySave(notionKey);
      if (r.success) {
        setNotionKeyStatus('Notion key saved.', 'success');
        notionKeyInput.value = '';
      } else {
        setNotionKeyStatus(r.error || 'Failed to save Notion key.', 'error');
      }
    }
    await Promise.all([checkApiKeyStatus(), checkNotionStatus()]);
    setTimeout(closeModal, 1200);
  } catch {
    setKeyStatus('Unexpected error saving keys.', 'error');
  } finally {
    btnKeySave.disabled    = false;
    btnKeySave.textContent = 'Save Keys';
  }
});

// Clear Anthropic key
btnKeyClear.addEventListener('click', async () => {
  if (!confirm('Clear your saved Anthropic API key?')) return;
  await window.seniorPartner.apiKeyClear();
  setKeyStatus('Anthropic key cleared.', 'success');
  await checkApiKeyStatus();
  setTimeout(closeModal, 1000);
});

// Show/hide Notion key
btnToggleNotionKey.addEventListener('click', () => {
  const isPwd = notionKeyInput.type === 'password';
  notionKeyInput.type         = isPwd ? 'text' : 'password';
  btnToggleNotionKey.textContent = isPwd ? '🙈' : '👁';
});

function setKeyStatus(msg, type) {
  apiKeyStatus.textContent = msg;
  apiKeyStatus.className   = `form-status form-status--${type}`;
}
function setNotionKeyStatus(msg, type) {
  notionKeyStatus.textContent = msg;
  notionKeyStatus.className   = `form-status form-status--${type}`;
}

// ─── Difficulty Toggle ────────────────────────────────────────────────────────
difficultyBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    difficultyBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentDifficulty = btn.dataset.level;
  });
});

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function markdownToHtml(text) {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings (###, ##, #)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,         '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists — collect consecutive items
  html = html.replace(/((?:^[*\-] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[*\-] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists
  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs — double newline → paragraph break; single newline → <br>
  html = html
    .split(/\n{2,}/)
    .map(para => {
      para = para.trim();
      if (!para) return '';
      if (/^<(h[1-3]|ul|ol|pre|blockquote|hr)/.test(para)) return para;
      return `<p>${para.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

// ─── Chat ────────────────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `chat-message chat-message--${role}`;

  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.src = 'assets/bianna_avatar.png';
    avatar.alt = 'Bianna';
    avatar.className = 'chat-avatar';
    wrapper.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (role === 'assistant') {
    bubble.innerHTML = markdownToHtml(text);
  } else {
    bubble.textContent = text;
  }

  wrapper.appendChild(bubble);
  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return bubble;
}

function showTypingIndicator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message chat-message--assistant';
  wrapper.id = 'typing-indicator-msg';

  const avatar = document.createElement('img');
  avatar.src = 'assets/bianna_avatar.png';
  avatar.alt = 'Bianna';
  avatar.className = 'chat-avatar';
  wrapper.appendChild(avatar);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  wrapper.appendChild(bubble);

  chatContainer.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator-msg');
  if (el) el.remove();
}

async function sendChat() {
  const prompt = chatInput.value.trim();
  if (!prompt || isAwaitingResponse) return;

  const exists = await window.seniorPartner.apiKeyExists();
  if (!exists) {
    openModal();
    return;
  }

  isAwaitingResponse = true;
  chatInput.value = '';
  btnSend.disabled = true;

  // Build final prompt — prepend attached file content if present
  let finalPrompt = prompt;
  if (attachedFile) {
    finalPrompt = `[Attached file: ${attachedFile.fileName}]\n\n${attachedFile.text}\n\n---\n\nUser question: ${prompt}`;
    // Clear attachment after sending
    attachedFile = null;
    attachedFileBar.hidden = true;
    attachedFileName.textContent = '';
  }

  appendMessage('user', prompt);
  showTypingIndicator();

  try {
    const result = await window.seniorPartner.aiPromptSend({
      prompt: finalPrompt,
      mode: 'chat',
      systemPrompt: buildSystemPrompt(),
    });

    removeTypingIndicator();

    if (result.success) {
      appendMessage('assistant', result.response);
    } else {
      appendMessage('assistant', `Error: ${result.error}`);
    }
  } catch (e) {
    removeTypingIndicator();
    appendMessage('assistant', `Unexpected error: ${e.message}`);
  } finally {
    isAwaitingResponse = false;
    btnSend.disabled = false;
    chatInput.focus();
  }
}

function buildSystemPrompt() {
  return `You are a Senior Law Partner mentoring a 1L law student named Bianna.
Use the Socratic method to guide her thinking. Be rigorous but encouraging.
Current difficulty level: ${currentDifficulty} — adjust the complexity of your questions and explanations accordingly.
Always structure case analysis using the IRAC framework (Issue, Rule, Application, Conclusion).
Use markdown formatting (bold, headers, lists) to make your responses clear and scannable.`;
}

btnSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    sendChat();
  }
});

// ─── Outline / IRAC Document Generation ──────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  const caseText = outlineInput.value.trim();
  const caseName = caseNameInput.value.trim() || 'Unnamed_Case';

  if (!caseText) {
    alert('Please paste some case text or a description before generating.');
    return;
  }

  const exists = await window.seniorPartner.apiKeyExists();
  if (!exists) {
    openModal();
    return;
  }

  btnGenerate.disabled = true;
  btnGenerate.textContent = '⏳ Generating…';

  try {
    const result = await window.seniorPartner.generateDocument({ caseText, caseName });
    if (result.success) {
      const notionNote = result.notionSynced ? ' Results also synced to your **Notion workspace**.' : '';
      const msg = result.message || `IRAC document for "${caseName}" generated successfully.`;
      appendMessage('assistant', `${msg}\n\nThe file has been opened automatically. Find all documents in the **sidebar** or your **Documents/Bianna_Law/** folder.${notionNote}`);
      refreshSidebar();
    } else {
      appendMessage('assistant', `**Document generation failed:** ${result.error}`);
    }
  } catch (e) {
    appendMessage('assistant', `**Unexpected error:** ${e.message}`);
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.textContent = '⬇ Generate IRAC Doc';
  }
});

// ─── Pane Resizer ─────────────────────────────────────────────────────────────
(function initPaneResizer() {
  const divider  = document.getElementById('pane-divider');
  const leftPane = document.querySelector('.pane--left');
  const splitPane = document.querySelector('.split-pane');
  let dragging = false;

  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = splitPane.getBoundingClientRect();
    const pct  = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(75, Math.max(25, pct));
    leftPane.style.flex = `0 0 ${clamped}%`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    divider.classList.remove('dragging');
  });
})();

// ─── Keyboard shortcut: Escape closes modal ───────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
});

// ─── Webview Navigation ───────────────────────────────────────────────────────
function normalizeUrl(raw) {
  raw = raw.trim();
  if (!raw) return '';

  // Convert bare YouTube watch URLs to embeds for cleaner viewing
  const ytMatch = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=0`;

  // Ensure there's a protocol
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function navigateWebview() {
  const url = normalizeUrl(urlInput.value);
  if (!url) return;
  urlInput.value = url;
  lawWebview.src = url;
}

btnGo.addEventListener('click', navigateWebview);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigateWebview();
});

// ─── YouTube Auto-Transcript Extraction ───────────────────────────────────────
let lastTranscriptUrl = '';

async function maybeExtractYoutubeTranscript(url) {
  // Only trigger for YouTube watch or embed URLs
  const isYoutube = /youtube\.com\/(watch|embed)|youtu\.be\//.test(url);
  if (!isYoutube) return;
  // Avoid re-fetching for the same video (in-page navigations)
  const idMatch = url.match(/(?:v=|embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!idMatch) return;
  const videoId = idMatch[1];
  if (lastTranscriptUrl === videoId) return;
  lastTranscriptUrl = videoId;

  transcriptBox.value = 'Fetching transcript…';
  const result = await window.seniorPartner.extractYoutubeTranscript(url);
  if (result.success && result.transcript) {
    transcriptBox.value = result.transcript;
    transcriptBox.scrollTop = 0;
  } else {
    transcriptBox.value = '';
    // Silently clear — transcript may not be available for this video
    console.warn('[transcript]', result.error);
  }
}

btnClearWebview.addEventListener('click', () => {
  lawWebview.src = 'https://www.google.com';
  urlInput.value = '';
});

// ─── Webview Focus Management ─────────────────────────────────────────────────
// Problem: After the webview navigates, Electron returns focus to the parent
// window's renderer process, causing "typing disappears" — keystrokes after
// the first search go nowhere from the user's perspective.
// Fix: re-focus the webview after load, but ONLY when the user is not actively
// typing in a right-pane input (chat, outline, case name).
const RIGHT_PANE_INPUTS = () => [chatInput, outlineInput, caseNameInput];
function isRightPaneFocused() {
  return RIGHT_PANE_INPUTS().includes(document.activeElement);
}

// Update URL bar when webview navigates
lawWebview.addEventListener('did-navigate', (e) => {
  if (e.url && e.url !== 'about:blank') {
    urlInput.value = e.url;
    maybeExtractYoutubeTranscript(e.url);
  }
});
lawWebview.addEventListener('did-navigate-in-page', (e) => {
  if (e.url && e.url !== 'about:blank') urlInput.value = e.url;
});

// Return focus to the webview after page load so the user can keep typing
// (e.g. after a Google search redirects to results).
lawWebview.addEventListener('did-finish-load', () => {
  if (!isRightPaneFocused()) {
    lawWebview.focus();
  }
});

// ─── Transcript → Summarize ───────────────────────────────────────────────────
btnSendTranscript.addEventListener('click', async () => {
  const transcript = transcriptBox.value.trim();
  if (!transcript) { alert('Paste a transcript first.'); return; }

  const prompt = `Summarize the following lecture transcript. Extract and clearly present: the main legal concepts covered, key cases or rules mentioned, and 3 key takeaways for a 1L student.\n\nTranscript:\n${transcript}`;

  chatInput.value = prompt;
  appendMessage('assistant', `_Summarizing transcript (${transcript.length} chars)…_`);
  sendChat();

  // Sync to Notion after a short delay to let the AI response land
  setTimeout(async () => {
    const notionOk = await window.seniorPartner.notionKeyExists();
    if (notionOk) {
      window.seniorPartner.notionSyncSummary({
        title:   `Transcript — ${new Date().toLocaleDateString()}`,
        type:    'Transcript Analysis',
        topic:   'Lecture Transcript',
        summary: transcript.slice(0, 2000),
      }).catch(() => {});
    }
  }, 500);
});

// ─── File Attachment ──────────────────────────────────────────────────────────
btnAttach.addEventListener('click', async () => {
  const result = await window.seniorPartner.pickAndReadFile();

  if (result.canceled) return;

  if (!result.success) {
    appendMessage('assistant', `**Could not read file:** ${result.error}`);
    return;
  }

  attachedFile = { fileName: result.fileName, text: result.text };
  attachedFileName.textContent = result.fileName;
  attachedFileBar.hidden = false;
});

btnRemoveAttachment.addEventListener('click', () => {
  attachedFile = null;
  attachedFileBar.hidden = true;
  attachedFileName.textContent = '';
});

// ─── Notion Syllabus Organizer ────────────────────────────────────────────────
btnOrganizeSyllabus.addEventListener('click', async () => {
  // Require an attached file
  if (!attachedFile) {
    appendMessage('assistant', 'Please attach a syllabus file first (PDF, DOCX, or TXT) using the 📎 button, then click **Organize Syllabus → Notion**.');
    return;
  }

  const notionOk = await window.seniorPartner.notionKeyExists();
  if (!notionOk) {
    appendMessage('assistant', 'Notion key not configured. Add your Notion integration token in **⚙ Settings** to enable the Syllabus Organizer.');
    openModal();
    return;
  }

  const apiOk = await window.seniorPartner.apiKeyExists();
  if (!apiOk) { openModal(); return; }

  const courseName = attachedFile.fileName.replace(/\.[^.]+$/, '') || 'Law Course';
  appendMessage('user', `Organize my syllabus: ${attachedFile.fileName}`);
  appendMessage('assistant', '⏳ Analyzing syllabus and building your Notion study dashboard…');

  btnOrganizeSyllabus.disabled    = true;
  btnOrganizeSyllabus.textContent = 'Organizing…';

  try {
    const result = await window.seniorPartner.organizeSyllabus({
      syllabusText: attachedFile.text,
      courseName,
    });

    if (result.success) {
      appendMessage('assistant',
        `✅ **Syllabus organized!** Created a color-coded ${result.weekCount}-week study dashboard for **${result.course}** in your Notion workspace.\n\n` +
        `Open Notion to view your schedule — readings are sorted by priority (🔴 High → 🟡 Medium → 🟢 Low) and difficulty (🧠 Hard → 📖 Medium → ✅ Easy).`
      );
      // Clear the attachment
      attachedFile = null;
      attachedFileBar.hidden = true;
      attachedFileName.textContent = '';
    } else {
      appendMessage('assistant', `**Syllabus Organizer failed:** ${result.error}`);
    }
  } finally {
    btnOrganizeSyllabus.disabled    = false;
    btnOrganizeSyllabus.textContent = 'Organize Syllabus → Notion';
  }
});

// ─── Westlaw Sidebar ──────────────────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('collapsed', !sidebarOpen);
});

async function refreshSidebar() {
  const files = await window.seniorPartner.listBiannaFiles();
  sidebarFileList.innerHTML = '';
  if (!files.length) {
    sidebarFileList.innerHTML = '<p class="sidebar__empty">No files yet. Generate an IRAC doc to get started.</p>';
    return;
  }
  files.forEach(f => {
    const ext  = f.name.split('.').pop().toLowerCase();
    const icon = ext === 'pdf' ? '📄' : ext === 'docx' ? '📝' : '📁';
    const el   = document.createElement('div');
    el.className = 'sidebar__file';
    el.title     = f.name;
    el.innerHTML = `<span class="sidebar__file-icon">${icon}</span><span class="sidebar__file-name">${f.name}</span>`;
    el.addEventListener('click', () => previewFileInApp(f.path));
    sidebarFileList.appendChild(el);
  });
}

btnRefreshFiles.addEventListener('click', refreshSidebar);
btnOpenFolder.addEventListener('click', () => window.seniorPartner.openDocumentsFolder());

// ─── Native In-App File Preview ───────────────────────────────────────────────
async function previewFileInApp(filePath) {
  const result = await window.seniorPartner.previewFile(filePath);
  if (!result.success) {
    appendMessage('assistant', `Could not preview file: ${result.error}`);
    return;
  }

  if (result.type === 'pdf') {
    // Load file:// URL — Chromium renders PDFs natively
    lawWebview.src = result.url;
    urlInput.value = result.url;
  } else if (result.type === 'docx') {
    // Convert HTML string to a data URL and load in webview
    const encoded = encodeURIComponent(result.html);
    lawWebview.src = `data:text/html;charset=utf-8,${encoded}`;
    urlInput.value = filePath;
  } else {
    // Plain text — show in transcript box for immediate use
    transcriptBox.value = result.text;
    transcriptBox.scrollTop = 0;
    urlInput.value = filePath;
  }
}

// Refresh sidebar after IRAC doc is generated (see btnGenerate listener below override)
const _origGenerateClick = btnGenerate.onclick;

// ─── Quiz Mode ────────────────────────────────────────────────────────────────
// Each element of quizQuestions is now an object:
//   MC:   { type: 'mc',   question: string, options: string[], answer: string }
//   FITB: { type: 'fitb', question: string }
function openQuiz(questions, topic) {
  quizQuestions = questions;
  quizIndex     = 0;
  quizScore     = 0;
  quizWrong     = [];
  quizTopic     = topic;

  quizTopicLabel.textContent = topic;
  quizOverlay.hidden = false;
  quizAnswer.hidden  = false;
  showQuizQuestion();
}

function showQuizQuestion() {
  const q = quizQuestions[quizIndex];

  quizQuestion.textContent     = q.question;
  quizFeedback.hidden          = true;
  quizFeedback.textContent     = '';
  quizFeedback.className       = 'quiz-feedback';
  btnQuizNext.hidden           = true;
  btnQuizFinish.hidden         = true;
  quizProgress.textContent     = `Question ${quizIndex + 1} of ${quizQuestions.length}`;
  quizScoreDisplay.textContent = `${quizScore}/${quizIndex} correct`;

  if (q.type === 'mc') {
    // Multiple-choice: show option buttons, hide textarea & submit
    quizOptions.hidden  = false;
    quizAnswer.hidden   = true;
    btnQuizSubmit.hidden = true;
    quizOptions.innerHTML = '';

    const keys = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option-btn';
      btn.innerHTML = `<span class="quiz-option-key">${keys[i]}</span>${opt}`;
      btn.addEventListener('click', () => handleMCAnswer(keys[i], q));
      quizOptions.appendChild(btn);
    });
  } else {
    // Fill-in-the-blank: hide option buttons, show textarea & submit
    quizOptions.hidden   = false; // keep in DOM but clear
    quizOptions.hidden   = true;
    quizAnswer.hidden    = false;
    quizAnswer.value     = '';
    quizAnswer.disabled  = false;
    btnQuizSubmit.hidden = false;
    quizAnswer.focus();
  }
}

function handleMCAnswer(chosen, q) {
  // Disable all option buttons
  quizOptions.querySelectorAll('.quiz-option-btn').forEach((btn, i) => {
    btn.disabled = true;
    const keys = ['A', 'B', 'C', 'D'];
    if (keys[i] === q.answer) btn.classList.add('quiz-option-btn--correct');
    else if (keys[i] === chosen) btn.classList.add('quiz-option-btn--wrong');
  });

  const correct = chosen === q.answer;
  if (correct) {
    quizScore++;
    quizFeedback.className = 'quiz-feedback quiz-feedback--correct';
    quizFeedback.innerHTML = `<span class="quiz-feedback__verdict">Correct!</span> ${q.answer}) is right.`;
  } else {
    quizWrong.push({ question: q.question, userAnswer: chosen, modelAnswer: q.answer });
    quizFeedback.className = 'quiz-feedback quiz-feedback--wrong';
    quizFeedback.innerHTML = `<span class="quiz-feedback__verdict">Not quite.</span> The correct answer is <strong>${q.answer}</strong>.`;
  }
  quizFeedback.hidden          = false;
  quizScoreDisplay.textContent = `${quizScore}/${quizIndex + 1} correct`;

  const isLast = quizIndex >= quizQuestions.length - 1;
  if (isLast) btnQuizFinish.hidden = false;
  else        btnQuizNext.hidden   = false;
}

btnStartQuiz.addEventListener('click', async () => {
  const transcript = transcriptBox.value.trim();
  if (!transcript) { alert('Paste a transcript first, then start the quiz.'); return; }

  const exists = await window.seniorPartner.apiKeyExists();
  if (!exists) { openModal(); return; }

  btnStartQuiz.disabled    = true;
  btnStartQuiz.textContent = 'Generating…';

  try {
    const numQ   = currentDifficulty === 'easy' ? 3 : currentDifficulty === 'hard' ? 7 : 5;
    // Mix: roughly half MC, half FITB
    const numMC   = Math.ceil(numQ / 2);
    const numFITB = numQ - numMC;
    const result = await window.seniorPartner.aiPromptSend({
      mode:   'quiz',
      prompt: `Generate exactly ${numQ} quiz questions (${currentDifficulty} difficulty) based on this transcript.
Mix: ${numMC} multiple-choice (type "mc") and ${numFITB} fill-in-the-blank (type "fitb").

Output ONLY a valid JSON array — no markdown, no extra text. Schema:
[
  { "type": "mc", "question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A" },
  { "type": "fitb", "question": "..." }
]

Rules:
- MC options must be plausible distractors; exactly one correct answer (A/B/C/D).
- FITB questions require a concise 1-3 sentence answer.
- Questions must be ${currentDifficulty}-level for a 1L law student.

Transcript:
${transcript.slice(0, 4000)}`,
    });

    if (!result.success) { alert('Failed to generate questions: ' + result.error); return; }

    let questions;
    try {
      const raw = result.response.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
      questions  = JSON.parse(raw);
      if (!Array.isArray(questions) || !questions.length) throw new Error('empty');
      // Validate each entry has at least type + question
      questions = questions.filter(q => q && q.type && q.question);
      if (!questions.length) throw new Error('no valid questions');
    } catch {
      alert('Could not parse quiz questions. Please try again.');
      return;
    }

    const topic = `Transcript Quiz — ${new Date().toLocaleDateString()} (${currentDifficulty})`;
    openQuiz(questions, topic);
  } finally {
    btnStartQuiz.disabled    = false;
    btnStartQuiz.textContent = 'Start Quiz';
  }
});

btnQuizSubmit.addEventListener('click', async () => {
  const answer = quizAnswer.value.trim();
  if (!answer) { quizAnswer.focus(); return; }

  btnQuizSubmit.disabled    = true;
  btnQuizSubmit.textContent = 'Grading…';
  quizAnswer.disabled       = true;

  try {
    const currentQ = quizQuestions[quizIndex];
    const result = await window.seniorPartner.aiPromptSend({
      mode:   'grade',
      prompt: `Question: ${currentQ.question}\n\nStudent Answer: ${answer}`,
    });

    let grade = { correct: false, score: 0, feedback: result.response, model_answer: '' };
    if (result.success) {
      try {
        const raw = result.response.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
        grade = JSON.parse(raw);
      } catch { /* use raw feedback */ }
    }

    if (grade.correct || grade.score > 0) {
      quizScore++;
      quizFeedback.className = 'quiz-feedback quiz-feedback--correct';
      quizFeedback.innerHTML = `<span class="quiz-feedback__verdict">Correct!</span>${grade.feedback || ''}`;
    } else {
      quizWrong.push({ question: currentQ.question, userAnswer: answer, modelAnswer: grade.model_answer || '' });
      quizFeedback.className = 'quiz-feedback quiz-feedback--wrong';
      quizFeedback.innerHTML = `<span class="quiz-feedback__verdict">Not quite.</span>${grade.feedback || ''}${grade.model_answer ? `<div class="quiz-feedback__model"><strong>Model answer:</strong> ${grade.model_answer}</div>` : ''}`;
    }

    quizFeedback.hidden          = false;
    quizScoreDisplay.textContent = `${quizScore}/${quizIndex + 1} correct`;
    btnQuizSubmit.hidden         = true;

    const isLast = quizIndex >= quizQuestions.length - 1;
    if (isLast) {
      btnQuizFinish.hidden = false;
    } else {
      btnQuizNext.hidden = false;
    }
  } finally {
    btnQuizSubmit.disabled    = false;
    btnQuizSubmit.textContent = 'Submit Answer';
  }
});

btnQuizNext.addEventListener('click', () => {
  quizIndex++;
  showQuizQuestion();
});

btnQuizFinish.addEventListener('click', async () => {
  const pct      = Math.round((quizScore / quizQuestions.length) * 100);
  const wrongStr = quizWrong.map((w, i) => `Q${i+1}: ${w.question}\nAnswer: ${w.userAnswer}\nModel: ${w.modelAnswer}`).join('\n\n');

  // Show results in quiz body
  quizQuestion.innerHTML = `
    <div class="quiz-results">
      <div class="quiz-results__score">${pct}%</div>
      <div class="quiz-results__label">${quizScore} of ${quizQuestions.length} correct</div>
      <div class="quiz-results__breakdown">${quizWrong.length === 0 ? 'Perfect score!' : `Missed ${quizWrong.length} question${quizWrong.length > 1 ? 's' : ''}.`}</div>
    </div>`;
  quizAnswer.hidden      = true;
  quizFeedback.hidden    = true;
  btnQuizFinish.hidden   = true;
  btnQuizNext.hidden     = true;
  btnQuizSubmit.hidden   = true;
  quizProgress.textContent     = 'Complete';
  quizScoreDisplay.textContent = `${quizScore}/${quizQuestions.length} — ${pct}%`;

  // Sync to Notion
  const notionOk = await window.seniorPartner.notionKeyExists();
  if (notionOk) {
    const syncResult = await window.seniorPartner.notionSyncQuiz({
      topic:       quizTopic,
      score:       quizScore,
      total:       quizQuestions.length,
      difficulty:  currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1),
      wrongAnswers: wrongStr.slice(0, 2000),
    });
    if (syncResult.success) {
      appendMessage('assistant', `Quiz complete: **${quizScore}/${quizQuestions.length} (${pct}%)** — results synced to your Notion workspace.`);
    }
  } else {
    appendMessage('assistant', `Quiz complete: **${quizScore}/${quizQuestions.length} (${pct}%)**. Add a Notion key in Settings to auto-save results.`);
  }
});

btnQuizClose.addEventListener('click', () => {
  quizOverlay.hidden = true;
  quizAnswer.hidden  = false;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
