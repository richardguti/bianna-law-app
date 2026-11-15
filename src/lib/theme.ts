/**
 * Theme engine — applies the stored palette to the document as CSS custom
 * properties. Tailwind v4 compiles its `@theme` tokens to `:root` custom
 * properties and every generated utility references `var(--color-*)`, so writing
 * these properties at runtime re-themes the whole app live (inline styles on
 * <html> outrank the stylesheet).
 */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface UiPrefs {
  theme: ThemeMode
  /** null = follow the theme default for that colour */
  background: string | null
  surface: string | null
  primary: string | null
  text: string | null
}

export const DEFAULT_PREFS: UiPrefs = {
  theme: 'system',
  background: null,
  surface: null,
  primary: null,
  text: null,
}

/** Full ramps so a dark switch never leaves half the surface hierarchy light. */
const LIGHT_RAMP = {
  background:                '#f2ede2',
  surface:                   '#fbf8f1',
  surfaceContainerLow:       '#ece6d9',
  surfaceContainer:          '#e7e0d1',
  surfaceContainerHigh:      '#e0d8c8',
  surfaceVariant:            '#ddd5c4',
  primary:                   '#1b1b19',
  primaryContainer:          '#e7dccb',
  accent:                    '#a8452b',
  text:                      '#1b1b19',
  textVariant:               '#57534a',
  outline:                   '#8a8375',
  outlineVariant:            '#dad4c6',
}

const DARK_RAMP = {
  background:                '#14130f',
  surface:                   '#1c1a15',
  surfaceContainerLow:       '#232019',
  surfaceContainer:          '#29251d',
  surfaceContainerHigh:      '#332e24',
  surfaceVariant:            '#454034',
  primary:                   '#f0e8d8',
  primaryContainer:          '#332e24',
  accent:                    '#c4593c',
  text:                      '#ede6d8',
  textVariant:               '#c9c2b2',
  outline:                   '#8f8878',
  outlineVariant:            '#454034',
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const clean = (hex || '').replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Pick black or white for text sitting on the given colour (best contrast). */
export function readableOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#111111') ? '#ffffff' : '#111111'
}

export function isValidHex(value: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test((value || '').trim())
}

export function normaliseHex(value: string): string {
  const v = (value || '').trim()
  return v.startsWith('#') ? v : `#${v}`
}

/** Effective palette for a preference set (user overrides win over the ramp). */
export function resolvePalette(prefs: UiPrefs, systemPrefersDark: boolean) {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemPrefersDark)
  const ramp = dark ? DARK_RAMP : LIGHT_RAMP
  return {
    dark,
    background:         prefs.background || ramp.background,
    surface:            prefs.surface    || ramp.surface,
    surfaceContainerLow:  ramp.surfaceContainerLow,
    surfaceContainer:     ramp.surfaceContainer,
    surfaceContainerHigh: ramp.surfaceContainerHigh,
    surfaceVariant:       ramp.surfaceVariant,
    primary:            prefs.primary || ramp.primary,
    primaryContainer:   ramp.primaryContainer,
    accent:             ramp.accent,
    text:               prefs.text    || ramp.text,
    textVariant:        ramp.textVariant,
    outline:            ramp.outline,
    outlineVariant:     ramp.outlineVariant,
  }
}

/** Write the palette onto <html> as the token set Tailwind consumes. */
export function applyTheme(prefs: UiPrefs, systemPrefersDark: boolean): ReturnType<typeof resolvePalette> {
  const p = resolvePalette(prefs, systemPrefersDark)
  const root = document.documentElement
  const set = (name: string, value: string) => root.style.setProperty(name, value)

  set('--color-background', p.background)
  set('--color-surface', p.surface)
  set('--color-surface-bright', p.surface)
  set('--color-surface-dim', p.surfaceContainerHigh)
  set('--color-surface-container-lowest', p.surface)
  set('--color-surface-container-low', p.surfaceContainerLow)
  set('--color-surface-container', p.surfaceContainer)
  set('--color-surface-container-high', p.surfaceContainerHigh)
  set('--color-surface-container-highest', p.surfaceContainerHigh)
  set('--color-surface-variant', p.surfaceVariant)
  set('--color-primary', p.primary)
  set('--color-on-primary', readableOn(p.primary))
  // The sand fill is its own token, not a copy of primary: primary is ink now, and copying it
  // here is what turned every secondary button black the last time the palette moved.
  set('--color-primary-container', p.primaryContainer)
  set('--color-accent', p.accent)
  set('--color-on-accent', readableOn(p.accent))
  set('--color-on-surface', p.text)
  set('--color-on-background', p.text)
  set('--color-on-surface-variant', p.textVariant)
  set('--color-outline', p.outline)
  set('--color-outline-variant', p.outlineVariant)
  set('--color-inverse-surface', p.text)
  set('--color-inverse-on-surface', p.background)

  root.dataset.theme = p.dark ? 'dark' : 'light'
  root.style.colorScheme = p.dark ? 'dark' : 'light'
  return p
}

/** Latest applied prefs, so late events (e.g. OS theme change) use current values. */
let currentPrefs: UiPrefs = DEFAULT_PREFS

function systemPrefersDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

/** Apply + remember. Call this whenever the user changes an appearance setting. */
export function setTheme(prefs: UiPrefs): ReturnType<typeof resolvePalette> {
  currentPrefs = prefs
  return applyTheme(prefs, systemPrefersDark())
}

export function currentThemePrefs(): UiPrefs {
  return currentPrefs
}

/** Load persisted prefs, apply them, and keep 'system' in sync with the OS. */
export async function initTheme(): Promise<UiPrefs> {
  let prefs = DEFAULT_PREFS
  try {
    const stored = await window.seniorPartner?.getUiPreferences?.()
    if (stored) prefs = { ...DEFAULT_PREFS, ...stored }
  } catch { /* fall back to system theme */ }

  setTheme(prefs)

  // Re-apply when the OS switches appearance (only matters for theme: 'system').
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      applyTheme(currentPrefs, systemPrefersDark())
    })
  } catch { /* older engines */ }

  return prefs
}
