/**
 * Whiteboard storage and conversion.
 *
 * Written as a factory that receives its dependencies rather than reaching for Electron
 * globals, so the storage rules can be exercised in plain Node. Every persistence bug in
 * this project so far was only discoverable by clicking through a UI — that is the failure
 * mode this shape exists to avoid.
 *
 * The write/read contract, stated once:
 *   live view has : scene elements, a title, the extracted text
 *   we write      : <name>.excalidraw (scene), <name>.png (render), <name>.md (text)
 *   we read back  : the scene, verbatim, plus enough metadata to list it
 * Anything the canvas needs to reopen must live in the .excalidraw file. The .png is a
 * convenience and the .md exists so the sketch is searchable through the ICM index.
 */
const fs = require('fs');
const path = require('path');

/** Below this we do not call the model at all — a fragment cannot become an outline. */
const MIN_SOURCE_CHARS = 40;

/**
 * Titles come from user text and become filenames, so this is the traversal guard.
 * Same discipline as the ICM action guard: renderer input is untrusted, not a path part.
 */
function safeName(input) {
  const raw = String(input == null ? '' : input)
    .replace(/[\\/:*?"<>|]/g, '-')      // no separators, no drive colons
    .replace(/[\x00-\x1f]/g, '')        // no control characters
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = raw.replace(/^\.+/, '').replace(/\.+$/, '').trim();  // no '..', no trailing dots
  if (!stripped) return 'Untitled';
  return stripped.slice(0, 80).trim() || 'Untitled';
}

function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Text-tool content is exact and freehand is deliberately not read, so this is the whole
 * extraction step: no OCR, no heuristics, nothing that can be wrong about what it read.
 * The strokes are not lost — they live in the .excalidraw file and the .png.
 */
function extractText(scene) {
  const els = scene && Array.isArray(scene.elements) ? scene.elements : [];
  return els
    .filter((e) => e && e.type === 'text' && typeof e.text === 'string' && e.text.trim())
    .map((e) => e.text.trim());
}

/**
 * The conversion prompt. It does NOT claim the text is OCR output: the corrected scope
 * reads the text tool only, so the text is exact. Telling the model it was OCR would
 * invite it to "correct" text that is already right.
 */
function buildPrompt(text) {
  return [
    'The user sketched the following notes on a whiteboard. The text below was read from the canvas text tool, so it is exact — it is not OCR output and must not be "corrected".',
    'Generate a BIA-style four-tier outline from this material.',
    'Do not add doctrinal content not present in the source.',
    'If the source is too fragmentary, list what is present and stop.',
    '',
    'SOURCE:',
    text,
  ].join('\n');
}

function createWhiteboard({ getDir, generateOutline, log = () => {} } = {}) {
  if (typeof getDir !== 'function') throw new Error('createWhiteboard requires getDir()');

  function rootDir() {
    const d = getDir();
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Resolve a requested filename to a path inside rootDir, or throw. */
  function resolveInRoot(requested) {
    const root = rootDir();
    const base = path.basename(String(requested || ''));
    if (!base || base === '.' || base === '..') throw new Error('Invalid whiteboard name.');
    const full = path.join(root, base);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Invalid whiteboard name.');
    return full;
  }

  function list() {
    const root = rootDir();
    let files = [];
    try { files = fs.readdirSync(root); } catch { return []; }
    return files
      .filter((f) => f.toLowerCase().endsWith('.excalidraw'))
      .map((f) => {
        const full = path.join(root, f);
        let st = null;
        try { st = fs.statSync(full); } catch { return null; }
        const stem = f.slice(0, -'.excalidraw'.length);
        return {
          file: f,
          name: stem,
          title: stem.replace(/^\d{8}-\d{6}\s*-\s*/, ''),
          bytes: st.size,
          mtime: st.mtimeMs,
          hasPng: fs.existsSync(path.join(root, stem + '.png')),
          hasMd: fs.existsSync(path.join(root, stem + '.md')),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  }

  function load({ file } = {}) {
    const full = resolveInRoot(file);
    if (!fs.existsSync(full)) return { success: false, error: 'That whiteboard no longer exists.' };
    let scene;
    try { scene = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch (err) { return { success: false, error: `That whiteboard file is unreadable (${err.message}).` }; }
    const stem = path.basename(full, '.excalidraw');
    const pngPath = path.join(rootDir(), stem + '.png');
    return {
      success: true,
      file: path.basename(full),
      scene,
      text: extractText(scene),
      pngDataUrl: fs.existsSync(pngPath)
        ? `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`
        : null,
    };
  }

  /**
   * Writes the three files. The scene goes via temp-file + rename, so a crash mid-write
   * cannot leave a half-written canvas where a readable one used to be.
   */
  function save({ title, scene, pngBase64 } = {}) {
    if (!scene || typeof scene !== 'object') return { success: false, error: 'Nothing to save.' };
    const root = rootDir();
    const stem = `${fileStamp()} - ${safeName(title)}`;
    const jsonPath = path.join(root, stem + '.excalidraw');
    const pngPath = path.join(root, stem + '.png');
    const mdPath = path.join(root, stem + '.md');

    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const payload = {
      type: 'excalidraw',
      version: 2,
      source: 'Senior Law Partner',
      elements,
      // appState is deliberately NOT persisted wholesale: it carries transient editor
      // state (open dialogs, collaboration flags, scroll) that must not enter the file.
      appState: {
        viewBackgroundColor: (scene.appState && scene.appState.viewBackgroundColor) || '#ffffff',
        gridSize: (scene.appState && scene.appState.gridSize) || null,
      },
    };

    try {
      const tmp = jsonPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, jsonPath);
      if (typeof pngBase64 === 'string' && pngBase64) {
        const b64 = pngBase64.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));
      }
      const text = extractText(scene);
      fs.writeFileSync(mdPath, [
        `# ${safeName(title)}`,
        '',
        `**Sketch:** ${stem}.excalidraw`,
        `**Rendered:** ${stem}.png`,
        `**Captured:** ${new Date().toISOString()}`,
        `**Text-tool labels:** ${text.length}`,
        '',
        '---',
        '',
        text.length ? text.join('\n') : '_(no text-tool content — freehand strokes are not read)_',
        '',
      ].join('\n'), 'utf8');
      log(`[whiteboard] saved ${stem} (${elements.length} elements, ${text.length} text items)`);
      return {
        success: true, file: stem + '.excalidraw', stem, dir: root,
        jsonPath, pngPath, mdPath, textCount: text.length, elementCount: elements.length,
      };
    } catch (err) {
      log(`[whiteboard] save failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Confirmed text -> four-tier outline. No model call below the size floor. */
  async function convert({ text, title } = {}) {
    const src = String(text == null ? '' : text).trim();
    if (!src) return { success: false, reason: 'empty', error: 'Nothing to convert.' };
    if (src.length < MIN_SOURCE_CHARS) {
      return {
        success: false,
        reason: 'too_short',
        error: `Not enough text extracted (${src.length} of ${MIN_SOURCE_CHARS} characters). Add more using the text tool.`,
      };
    }
    if (typeof generateOutline !== 'function') {
      return { success: false, error: 'Outline generation is unavailable.' };
    }
    try {
      const out = await generateOutline({ prompt: buildPrompt(src), title: safeName(title) });
      if (!out || !out.success) {
        return { success: false, error: (out && out.error) || 'The outline could not be generated.' };
      }
      return {
        success: true,
        outline: out.outline || out.html || '',
        docxPath: out.docxPath || null,
        chars: src.length,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { list, load, save, convert, rootDir, safeName, extractText, buildPrompt, MIN_SOURCE_CHARS };
}

module.exports = { createWhiteboard, safeName, extractText, buildPrompt, fileStamp, MIN_SOURCE_CHARS };
