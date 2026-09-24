import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadEditableField,
  addCustomValue,
  removeCustomValue,
  saveSelectedValue,
} from '../lib/editableFields'

/**
 * EditableChipGroup — the single preset-field control for the whole app (Part 5).
 *
 * Every field that presents a preset list uses this: Subject, Mode, Course, Discipline.
 * Adding a new preset field is one line, because custom entry, persistence, removal and
 * the DONE/X affordances all live here rather than in each page.
 *
 * Two preset shapes are supported so the component can replace both existing chip
 * styles without losing anything: a plain string renders as a compact chip (the Outline
 * Generator's Subject grid), while `{ value, label, icon, desc }` renders as the richer
 * card the Outline Generator uses for Mode.
 */

export type ChipPreset = { value: string; label: string; icon?: string; desc?: string }
export type ChipValue = string | ChipPreset

interface Props {
  presets: ChipValue[]
  value: string | string[]
  onChange: (value: string | string[]) => void
  /** Multi-select: the value is a string[] and each chip toggles. */
  multi?: boolean
  /** Namespace for the persisted custom list, e.g. 'outline-generator/subject'. */
  storageKey: string
  columns?: 1 | 2
  /** Set false only with a documented reason — custom entry is the default. */
  allowCustom?: boolean
  /** Also remember the current selection (for surfaces with free-text values). */
  persistValue?: boolean
  placeholder?: string
  /** Optional line rendered under the grid, e.g. "Using X as the subject context." */
  hint?: string
}

const toPreset = (p: ChipValue): ChipPreset => (typeof p === 'string' ? { value: p, label: p } : p)

export function EditableChipGroup({
  presets,
  value,
  onChange,
  multi = false,
  storageKey,
  columns = 2,
  allowCustom = true,
  persistValue = false,
  placeholder = 'Type a custom value…',
  hint,
}: Props) {
  const presetList = useMemo(() => presets.map(toPreset), [presets])
  const [customValues, setCustomValues] = useState<string[]>([])
  const [draft, setDraft] = useState(() => (typeof value === 'string' ? value : ''))
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected: string[] = Array.isArray(value) ? value : value ? [value] : []
  const isActive = (v: string) => selected.some((s) => s.toLowerCase() === v.toLowerCase())

  // Mirror of the list for the mount reconciliation below. The reconciliation must read
  // the CURRENT list, not the empty one captured when the effect was created, and putting
  // `customValues` in the dependency array would re-run the load on every change.
  const customValuesRef = useRef<string[]>([])
  useEffect(() => { customValuesRef.current = customValues }, [customValues])

  // Load the persisted custom values, then reconcile BOTH directions so memory and the
  // store cannot drift: values the store has and memory lacks are adopted, and values
  // memory has and the store lacks are pushed up. The store is the source of truth; the
  // component's list is a cache of it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const record = await loadEditableField(storageKey)
      if (cancelled) return

      let merged = record.customValues
      const memoryOnly = customValuesRef.current.filter(
        (v) => !merged.some((s) => s.toLowerCase() === v.toLowerCase()),
      )
      for (const value of memoryOnly) {
        // Idempotent in the main process, so replaying a value the store already has is
        // a no-op rather than a duplicate chip.
        const next = await addCustomValue(storageKey, value)
        if (next.length) merged = next
      }
      if (cancelled) return

      setCustomValues(merged)
      if (persistValue && record.value && !selected.length) onChange(record.value)
    })()
    return () => { cancelled = true }
    // Intentionally keyed on storageKey only: re-running on every value change would
    // fight the user's typing and could clobber a fresh selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, persistValue])

  // Mirror an externally-changed selection into the input, unless it is being typed in.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return
    setDraft(Array.isArray(value) ? '' : (value ?? ''))
  }, [value])

  function emit(next: string | string[]) {
    onChange(next)
  }

  async function togglePreset(v: string) {
    if (multi) {
      const set = new Set(selected)
      const existing = [...set].find((s) => s.toLowerCase() === v.toLowerCase())
      if (existing) set.delete(existing); else set.add(v)
      emit([...set])
    } else {
      emit(v)
    }
    if (persistValue) await saveSelectedValue(storageKey, v)
  }

  /** DONE — adopt whatever is in the input, remembering it if it is new. */
  async function commitDraft() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      // No "do I already have this?" guard against the in-memory list. That guard read a
      // cache: if the list was stale, the write was skipped entirely and the chip
      // rendered while the store never gained the value. addCustomValue is idempotent in
      // the main process, so it is always safe to call, and its return value - the
      // store's list - is what memory is set from.
      const isPreset = presetList.some((p) => p.value.toLowerCase() === text.toLowerCase())
      if (allowCustom && !isPreset) {
        const next = await addCustomValue(storageKey, text)
        if (next.length) setCustomValues(next)
      }
      if (multi) {
        const set = new Set(selected)
        if (![...set].some((s) => s.toLowerCase() === text.toLowerCase())) set.add(text)
        emit([...set])
      } else {
        emit(text)
      }
      if (persistValue) await saveSelectedValue(storageKey, text)
    } finally {
      setBusy(false)
    }
  }

  /** X — clear the field entirely. */
  async function clearAll() {
    setDraft('')
    emit(multi ? [] : '')
    if (persistValue) await saveSelectedValue(storageKey, '')
    inputRef.current?.focus()
  }

  async function removeCustom(v: string) {
    setBusy(true)
    try {
      const next = await removeCustomValue(storageKey, v)
      setCustomValues(next)
      // If the value being removed was selected, deselect it.
      if (isActive(v)) emit(multi ? selected.filter((s) => s.toLowerCase() !== v.toLowerCase()) : '')
    } finally {
      setBusy(false)
    }
  }
  const chips = [
    ...presetList.map((p) => ({ p, custom: false })),
    ...customValues.map((c) => ({ p: { value: c, label: c } as ChipPreset, custom: true })),
  ]
  // Rich cards (icon/description) preserve the Outline Generator's Mode look; without
  // them the compact chip grid is used, as for Subject.
  const rich = chips.some(({ p }) => p.icon || p.desc)
  const gridCls = columns === 1 ? 'grid-cols-1' : 'grid-cols-2'

  return (
    <div className="space-y-3">
      <div className={`grid ${gridCls} ${rich ? 'gap-3' : 'gap-2'}`}>
        {chips.map(({ p, custom }) => {
          const active = isActive(p.value)
          const key = `${custom ? 'custom' : 'preset'}:${p.value}`

          if (rich) {
            return (
              <div key={key} className="relative group">
                <button
                  type="button"
                  onClick={() => togglePreset(p.value)}
                  className={`w-full p-3 rounded-xl text-left space-y-1.5 transition-all relative ${
                    active
                      ? 'bg-primary text-on-primary shadow-lg'
                      : 'bg-surface-container-lowest border border-outline-variant/20 hover:bg-surface-container-high'
                  }`}
                >
                  {active && (
                    <span className="absolute top-1.5 right-1.5 material-symbols-outlined text-[12px] opacity-70">check</span>
                  )}
                  {p.icon && (
                    <span className={`material-symbols-outlined text-lg ${active ? '' : 'text-primary'}`}>{p.icon}</span>
                  )}
                  <p className="text-[10px] font-bold font-label uppercase tracking-wider flex items-center gap-1.5">
                    {custom && !p.icon && (
                      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-on-primary' : 'bg-primary'}`} aria-hidden="true" />
                    )}
                    {p.label}
                  </p>
                  {p.desc && (
                    <p className={`text-[9px] leading-snug ${active ? 'opacity-80' : 'text-on-surface-variant'}`}>{p.desc}</p>
                  )}
                </button>
                {custom && (
                  <button
                    type="button"
                    onClick={() => removeCustom(p.value)}
                    disabled={busy}
                    title={`Remove custom value ${p.label}`}
                    aria-label={`Remove custom value ${p.label}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] leading-none bg-surface-container-lowest border border-outline-variant/40 text-on-surface-variant opacity-0 group-hover:opacity-100 focus:opacity-100 hover:border-error hover:text-error transition-all"
                  >
                    &times;
                  </button>
                )}
              </div>
            )
          }

          return (
            <div key={key} className="relative group">
              <button
                type="button"
                onClick={() => togglePreset(p.value)}
                title={p.label}
                className={`w-full px-3 py-2 rounded-lg text-xs font-bold text-center transition-colors truncate ${
                  active
                    ? 'bg-surface-container-lowest border border-primary text-primary'
                    : 'bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {custom && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 align-middle" aria-hidden="true" />
                )}
                {p.label}
              </button>
              {custom && (
                <button
                  type="button"
                  onClick={() => removeCustom(p.value)}
                  disabled={busy}
                  title={`Remove custom value ${p.label}`}
                  aria-label={`Remove custom value ${p.label}`}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] leading-none bg-surface-container-lowest border border-outline-variant/40 text-on-surface-variant opacity-0 group-hover:opacity-100 focus:opacity-100 hover:border-error hover:text-error transition-all"
                >
                  &times;
                </button>
              )}
            </div>
          )
        })}
      </div>

      {allowCustom && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commitDraft() } }}
            placeholder={placeholder}
            aria-label="Custom value"
            className="flex-1 bg-surface-container-low rounded-lg px-3 py-2 text-xs outline-none border border-outline-variant/20 focus:border-primary transition-all"
          />
          <button
            type="button"
            onClick={() => void commitDraft()}
            disabled={busy || !draft.trim()}
            className="px-3 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-wider bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => void clearAll()}
            title="Clear selection"
            aria-label="Clear selection"
            className="px-2.5 py-2 rounded-lg text-xs border border-outline-variant/30 text-on-surface-variant hover:border-error hover:text-error transition-colors"
          >
            &times;
          </button>
        </div>
      )}

      {hint && <p className="text-[10px] text-on-surface-variant">{hint}</p>}
    </div>
  )
}
