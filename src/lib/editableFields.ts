/**
 * Persistence helpers for editable preset fields (Part 5).
 *
 * Custom chip values live in the main process's electron-store, reached over the
 * `editable-fields:*` IPC channels. That keeps them with the app's other durable
 * settings (profile, calendar, UI prefs) instead of a renderer-specific localStorage
 * key, so they survive cache clears and are visible to the main process.
 *
 * The storage keys are centralised here: six surfaces share this component, and a
 * typo in one page's key would silently give that page its own private list.
 */

export type EditableFieldRecord = {
  customValues: string[]
  /** Last selection, when the surface opted into persisting it. */
  value?: string
}

/** Canonical storage keys — every surface picks from this list. */
export const EDITABLE_STORAGE_KEYS = {
  outlineSubject:   'outline-generator/subject',
  outlineMode:      'outline-generator/mode',
  studySubject:     'study-sessions/subject',
  studyMode:        'study-sessions/mode',
  trackerCourse:    'reading-tracker/course',
  captureDiscipline:'capture/discipline',
} as const

/**
 * Where the pre-1.2.0 app kept a typed custom subject. That path only existed for the
 * Outline Generator; the value now belongs in the shared custom-value list.
 */
const LEGACY_CUSTOM_SUBJECT_KEY = 'slp_custom_subject'

const bridge = () => (typeof window !== 'undefined' ? window.seniorPartner : undefined)

/** Custom values for a surface, plus its persisted selection when it has one. */
export async function loadEditableField(storageKey: string): Promise<EditableFieldRecord> {
  try {
    const res = await bridge()?.editableFieldsGet?.({ storageKey })
    if (res?.success) return { customValues: res.customValues ?? [], value: res.value }
  } catch { /* bridge unavailable (web dev) — behave as if empty */ }
  return { customValues: [] }
}

/** Persist a new custom value and return the updated list. */
export async function addCustomValue(storageKey: string, value: string): Promise<string[]> {
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const res = await bridge()?.editableFieldsAddCustom?.({ storageKey, value: trimmed })
    if (res?.success) return res.customValues ?? []
  } catch { /* silent — a failed add must not break the click that caused it */ }
  return []
}

/** Remove a custom value (and its chip) and return the updated list. */
export async function removeCustomValue(storageKey: string, value: string): Promise<string[]> {
  try {
    const res = await bridge()?.editableFieldsRemoveCustom?.({ storageKey, value })
    if (res?.success) return res.customValues ?? []
  } catch { /* silent */ }
  return []
}

/** Remember the current selection for surfaces whose value is free text. */
export async function saveSelectedValue(storageKey: string, value: string): Promise<void> {
  try { await bridge()?.editableFieldsSetValue?.({ storageKey, value }) } catch { /* silent */ }
}

/**
 * One-shot migration of the legacy custom subject into the shared list.
 * Returns the number of values migrated. Never throws: boot must not depend on it.
 */
export async function migrateLegacyCustomSubjects(): Promise<number> {
  try {
    const legacy = localStorage.getItem(LEGACY_CUSTOM_SUBJECT_KEY)
    if (!legacy || !legacy.trim()) return 0

    const res = await bridge()?.editableFieldsMigrateLegacy?.({
      storageKey: EDITABLE_STORAGE_KEYS.outlineSubject,
      values: [legacy.trim()],
    })
    // Only drop the legacy key once the main process has confirmed the write.
    if (res?.success) {
      localStorage.removeItem(LEGACY_CUSTOM_SUBJECT_KEY)
      console.log(`[editable-fields] migrated ${res.migrated ?? 0} legacy custom value(s)`)
      return res.migrated ?? 0
    }
  } catch { /* migration is best-effort */ }
  return 0
}
