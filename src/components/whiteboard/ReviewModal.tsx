import { useEffect, useState } from 'react'

/**
 * Review the extracted text before it is turned into an outline.
 *
 * This step is not optional. The conversion sends whatever is in the box to the model, so
 * the box is the last place a wrong reading can be caught. There is no OCR in this feature,
 * which is why the text is exact — but the *user* still has to confirm that the labels they
 * drew are the ones they meant.
 */
const MIN_SOURCE_CHARS = 40

interface Props {
  open: boolean
  initialText: string
  textCount: number
  busy: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: (text: string) => void
}

export function ReviewModal({ open, initialText, textCount, busy, error, onCancel, onConfirm }: Props) {
  const [text, setText] = useState(initialText)
  useEffect(() => { setText(initialText) }, [initialText, open])

  if (!open) return null
  const chars = text.trim().length
  const tooShort = chars < MIN_SOURCE_CHARS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-surface-container-lowest p-6 shadow-xl">
        <h2 className="text-sm font-label font-bold uppercase tracking-widest text-on-surface">
          Confirm what the whiteboard said
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
          {textCount} text-tool {textCount === 1 ? 'label' : 'labels'} found. Freehand strokes are
          not read — if something you drew by hand belongs in the outline, type it here.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          className="mt-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 font-mono text-xs leading-relaxed text-on-surface outline-none focus:border-primary/50"
          placeholder="Text-tool labels appear here. Add anything the pen captured that you want in the outline."
        />
        <div className="mt-2 flex items-center justify-between text-[11px] text-on-surface-variant">
          <span>{chars} characters</span>
          {tooShort && <span>Need at least {MIN_SOURCE_CHARS} before this can become an outline.</span>}
        </div>
        {error && <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-outline-variant/30 px-5 py-2.5 text-xs font-label font-bold uppercase tracking-widest text-on-surface-variant transition-colors hover:border-primary/40 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(text)}
            disabled={busy || tooShort}
            className="rounded-full bg-primary px-5 py-2.5 text-xs font-label font-bold uppercase tracking-widest text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Generating…' : 'Generate outline'}
          </button>
        </div>
      </div>
    </div>
  )
}
