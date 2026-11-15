/**
 * Renderer-side wrappers over the whiteboard IPC.
 *
 * The MAIN process owns the folder path (whiteboardDir() in main.js) and reports it back.
 * The renderer never derives a path of its own — that is deliberate: two places deciding
 * where a file lives is how the write and read paths drift apart, which is the bug class
 * the README now names.
 */

export type WhiteboardItem = {
  file: string
  name: string
  title: string
  bytes: number
  mtime: number
  hasPng: boolean
  hasMd: boolean
}

/**
 * A scene as it crosses the IPC boundary.
 *
 * `elements` is deliberately `unknown[]` rather than a narrowed `{ type, text }[]`. Excalidraw
 * elements carry fields the renderer depends on — `version`, `versionNonce`, `seed`,
 * `strokeStyle`, `roundness`, `boundElements` and more — and typing them away here invites a
 * "helpful" filter somewhere downstream. The one field-level rule that matters (text-tool
 * elements only) lives in textFromScene().
 *
 * The write path is the contract: jsons/whiteboard/index.js persists `elements` VERBATIM, with
 * no whitelist and no .map(). Filtering there would save a scene that reloads blank.
 */
export type Scene = {
  elements?: unknown[]
  appState?: Record<string, unknown>
}

export async function listWhiteboards(): Promise<{ items: WhiteboardItem[]; dir: string; error?: string }> {
  const bridge = window.seniorPartner
  if (!bridge?.whiteboardList) return { items: [], dir: '', error: 'Whiteboard storage is only available in the desktop app.' }
  const r = await bridge.whiteboardList()
  return { items: (r?.items ?? []) as WhiteboardItem[], dir: r?.dir ?? '', error: r?.error }
}

export async function loadWhiteboard(file: string) {
  const bridge = window.seniorPartner
  if (!bridge?.whiteboardLoad) return { success: false as const, error: 'Not available.' }
  return bridge.whiteboardLoad({ file })
}

export async function saveWhiteboard(title: string, scene: Scene, pngBase64: string | null) {
  const bridge = window.seniorPartner
  if (!bridge?.whiteboardSave) return { success: false as const, error: 'Not available.' }
  return bridge.whiteboardSave({ title, scene, pngBase64 })
}

export async function convertWhiteboard(text: string, title: string) {
  const bridge = window.seniorPartner
  if (!bridge?.whiteboardConvert) return { success: false as const, error: 'Not available.', reason: 'unavailable' }
  return bridge.whiteboardConvert({ text, title })
}

/**
 * Text-tool content only — the exact same rule as extractText() in
 * jsons/whiteboard/index.js. Freehand strokes are deliberately not read: there is no OCR
 * in this feature, so anything that becomes outline content must come from the text tool.
 * Kept in sync by construction: both filter on type === 'text'.
 */
export function textFromScene(scene: Scene | null | undefined): string[] {
  const els = scene?.elements
  if (!Array.isArray(els)) return []
  return (els as { type?: unknown; text?: unknown }[])
    .filter((e) => e && e.type === 'text' && typeof e.text === 'string' && e.text.trim())
    .map((e) => String(e.text).trim())
}
