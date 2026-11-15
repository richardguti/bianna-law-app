import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Whiteboard — a notebook you can actually draw on.
 *
 * The previous implementation mounted Excalidraw, and in this build it did not mount: the page fell
 * back to "Canvas unavailable — using label editor", which is a text box, not a whiteboard. Rather
 * than chase a heavy third-party editor that had already failed here, this is a plain canvas with
 * the four things the task needs: a pencil, an eraser, paper that looks like paper, and a way to
 * get what you drew out of the app.
 *
 * DESIGN NOTES
 *
 * - The rules and the margin are painted INTO the canvas, not applied as a CSS background behind
 *   it. A CSS background does not survive `toDataURL()`, so an exported sketch would arrive as
 *   strokes floating on nothing. Painting them means the PNG, the PDF and the vault copy all carry
 *   the page with them.
 *
 * - Strokes are stored as data, never as pixels. Undo, redo and re-render at any device pixel ratio
 *   all follow from that; a bitmap-only pad can do none of them.
 *
 * - The backing store is scaled by devicePixelRatio so lines are sharp on a high-DPI screen, while
 *   the pointer maths stays in CSS pixels.
 */

type Tool = 'pencil' | 'eraser' | 'highlighter'

interface Stroke {
  tool: Tool
  color: string
  width: number
  points: Array<{ x: number; y: number }>
}

const PAPER = '#fbf8f1'
const RULE = '#d8d2c4'
const MARGIN_RULE = '#c98a7e'
const INK = '#1b1b19'

const COLORS = [
  { id: 'graphite', label: 'Graphite', value: INK },
  { id: 'ink', label: 'Ink blue', value: '#1f3a68' },
  { id: 'red', label: 'Red pencil', value: '#a8452b' },
  { id: 'green', label: 'Green', value: '#4a6b45' },
]

const RULE_GAP = 32
const MARGIN_X = 64

interface VaultResult {
  success?: boolean
  error?: string
  canceled?: boolean
}

export function Whiteboard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [undone, setUndone] = useState<Stroke[]>([])
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState(INK)
  const [width, setWidth] = useState(2.5)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const drawing = useRef<Stroke | null>(null)

  /** Paint paper, rules, margin, then every stroke. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = canvas.clientWidth || 900
    const cssHeight = canvas.clientHeight || 600

    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr)
      canvas.height = Math.round(cssHeight * dpr)
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)

    // The page
    context.fillStyle = PAPER
    context.fillRect(0, 0, cssWidth, cssHeight)

    // Ruled lines
    context.strokeStyle = RULE
    context.lineWidth = 1
    for (let y = RULE_GAP; y < cssHeight; y += RULE_GAP) {
      context.beginPath()
      context.moveTo(0, y + 0.5)
      context.lineTo(cssWidth, y + 0.5)
      context.stroke()
    }

    // Margin
    context.strokeStyle = MARGIN_RULE
    context.beginPath()
    context.moveTo(MARGIN_X + 0.5, 0)
    context.lineTo(MARGIN_X + 0.5, cssHeight)
    context.stroke()

    // Strokes
    const all = drawing.current ? [...strokes, drawing.current] : strokes
    for (const stroke of all) {
      if (stroke.points.length === 0) continue
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = stroke.width
      context.strokeStyle = stroke.color
      if (stroke.tool === 'eraser') {
        // Erasing removes paint rather than painting paper over it, so the rules show through.
        context.globalCompositeOperation = 'destination-out'
        context.lineWidth = stroke.width * 3
      } else if (stroke.tool === 'highlighter') {
        context.globalAlpha = 0.28
        context.lineWidth = stroke.width * 6
      }
      context.beginPath()
      const [first, ...rest] = stroke.points
      context.moveTo(first.x, first.y)
      if (rest.length === 0) {
        context.lineTo(first.x + 0.1, first.y + 0.1)
      } else {
        let previous = first
        for (const point of rest) {
          const midX = (previous.x + point.x) / 2
          const midY = (previous.y + point.y) / 2
          context.quadraticCurveTo(previous.x, previous.y, midX, midY)
          previous = point
        }
      }
      context.stroke()
      context.restore()
    }
  }, [strokes])

  useEffect(() => {
    redraw()
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [redraw])

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    // Capture keeps the stroke alive when the pointer leaves the canvas mid-line. Not every engine
    // allows it for a synthetic pointer, and a refused capture should not cost the stroke.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* drawing continues without capture */
    }
    drawing.current = {
      tool,
      color: tool === 'eraser' ? INK : color,
      width,
      points: [pointFrom(event)],
    }
    redraw()
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    drawing.current.points.push(pointFrom(event))
    redraw()
  }

  function endStroke() {
    const stroke = drawing.current
    drawing.current = null
    if (!stroke) return
    setStrokes((current) => [...current, stroke])
    setUndone([])
  }

  function undo() {
    setStrokes((current) => {
      if (!current.length) return current
      const last = current[current.length - 1]
      setUndone((stack) => [...stack, last])
      return current.slice(0, -1)
    })
  }

  function redo() {
    setUndone((stack) => {
      if (!stack.length) return stack
      const restored = stack[stack.length - 1]
      setStrokes((current) => [...current, restored])
      return stack.slice(0, -1)
    })
  }

  function clear() {
    setStrokes([])
    setUndone([])
  }

  const pngDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.toDataURL('image/png')
  }, [])

  const documentHtml = useCallback(
    (dataUrl: string) => {
      const heading = (title.trim() || 'Sketch')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
      const body = notes.trim()
        ? `<p style="font-family:Georgia,serif;font-size:14px;line-height:1.6">${notes
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/\n/g, '<br/>')}</p>`
        : ''
      return `<div><h1 style="font-family:Georgia,serif">${heading}</h1>${body}<p><img src="${dataUrl}" style="width:100%;max-width:900px;border:1px solid #d8d2c4"/></p></div>`
    },
    [title, notes],
  )

  function download(dataUrl: string) {
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `${(title.trim() || 'sketch').replace(/\s+/g, '-').toLowerCase()}.png`
    link.click()
  }

  async function saveToVault() {
    const dataUrl = pngDataUrl()
    if (!dataUrl) return
    setBusy(true)
    setStatus(null)
    try {
      const result = (await window.seniorPartner?.vaultSave?.({
        topic: title.trim() || 'Sketch',
        subject: 'other',
        mode: 'whiteboard',
        tags: ['whiteboard', 'sketch'],
        html: documentHtml(dataUrl),
      })) as VaultResult | undefined

      if (result?.success) {
        setStatus('Saved to the Document Vault.')
      } else {
        download(dataUrl)
        setStatus('The Vault is unavailable here — the sketch was downloaded instead.')
      }
    } catch {
      download(dataUrl)
      setStatus('The Vault is unavailable here — the sketch was downloaded instead.')
    } finally {
      setBusy(false)
    }
  }

  async function exportAs(format: 'pdf' | 'docx') {
    const dataUrl = pngDataUrl()
    if (!dataUrl) return
    setBusy(true)
    setStatus(null)
    try {
      const result = (await window.seniorPartner?.exportDocument?.({
        topic: title.trim() || 'Sketch',
        subject: 'other',
        mode: 'whiteboard',
        html: documentHtml(dataUrl),
        format,
      })) as VaultResult | undefined

      if (result?.success) {
        setStatus(`Exported as ${format.toUpperCase()}.`)
      } else if (result?.canceled) {
        setStatus('Export cancelled.')
      } else {
        setStatus(result?.error ? `Export failed: ${result.error}` : 'Export failed.')
      }
    } catch {
      setStatus('Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const toolButton = (id: Tool, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTool(id)}
      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
        tool === id
          ? 'bg-primary text-on-primary'
          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="p-8 max-w-[1200px] mx-auto space-y-6">
      <header className="border-b border-outline-variant pb-5">
        <p className="label-micro">Whiteboard</p>
        <h1 className="text-4xl font-serif mt-2 leading-tight text-on-surface">Scribble it out</h1>
        <p className="text-[15px] text-on-surface-variant mt-2 leading-relaxed max-w-2xl">
          Ruled paper, a pencil, an eraser. Draw the way you would on a legal pad, then save it to
          the Vault or export it as a document.
        </p>
      </header>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {toolButton('pencil', 'Pencil')}
        {toolButton('highlighter', 'Highlighter')}
        {toolButton('eraser', 'Eraser')}

        <span className="mx-1 h-5 w-px bg-outline-variant" aria-hidden="true" />

        {COLORS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setColor(option.value)
              if (tool === 'eraser') setTool('pencil')
            }}
            aria-label={option.label}
            title={option.label}
            className={`h-6 w-6 border transition-transform ${
              color === option.value
                ? 'border-on-surface scale-110'
                : 'border-outline-variant hover:scale-105'
            }`}
            style={{ backgroundColor: option.value }}
          />
        ))}

        <label className="flex items-center gap-2 ml-2">
          <span className="label-micro">Weight</span>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            aria-label="Stroke weight"
            className="w-24 accent-current"
          />
          <span className="citation w-6 text-right">{width}</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!strokes.length}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!undone.length}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!strokes.length}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:border-primary/40 transition-colors disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      {/* ── Paper ────────────────────────────────────────────────────────── */}
      <div className="border border-outline-variant">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-outline-variant bg-surface-container-low">
          <label htmlFor="sketch-title" className="label-micro shrink-0">
            Title
          </label>
          <input
            id="sketch-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Wills and Trusts — ademption"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-on-surface-variant/60"
          />
          <span className="citation">
            {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          data-testid="sketchpad"
          className="block w-full touch-none cursor-crosshair"
          style={{ height: '600px' }}
        />
      </div>

      {/* ── Notes + actions ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="space-y-2">
          <label htmlFor="sketch-notes" className="label-micro">
            Notes to carry with the sketch
          </label>
          <textarea
            id="sketch-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Ademption — failure of a specific devise because the property is no longer in the estate."
            className="w-full bg-surface-container-lowest border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none transition-all resize-none"
          />
        </section>

        <section className="space-y-3">
          <p className="label-micro">Take it with you</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveToVault()}
              disabled={busy || !strokes.length}
              className="px-5 py-2.5 bg-primary text-on-primary label-micro hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Save to Vault
            </button>
            <button
              type="button"
              onClick={() => void exportAs('pdf')}
              disabled={busy || !strokes.length}
              className="px-4 py-2.5 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors disabled:opacity-40"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => void exportAs('docx')}
              disabled={busy || !strokes.length}
              className="px-4 py-2.5 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors disabled:opacity-40"
            >
              Export DOCX
            </button>
            <button
              type="button"
              onClick={() => {
                const dataUrl = pngDataUrl()
                if (dataUrl) download(dataUrl)
              }}
              disabled={!strokes.length}
              className="px-4 py-2.5 border border-outline-variant text-on-surface-variant label-micro hover:border-primary/40 transition-colors disabled:opacity-40"
            >
              Download PNG
            </button>
          </div>

          {status && (
            <p className="text-[13px] text-on-surface-variant leading-snug border-l-2 border-accent pl-3">
              {status}
            </p>
          )}

          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            The vault copy keeps the image inline, so it opens without the original file. The rules
            are painted into the image rather than applied as a background style, which is why they
            survive both the vault copy and the PDF.
          </p>
        </section>
      </div>
    </div>
  )
}
