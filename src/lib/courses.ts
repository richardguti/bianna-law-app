export type LocalCourse = {
  id: string
  name: string
  professor: string | null
  exam_date: string | null
  semester: string
  created_at: string
}

const KEY = 'slp_courses'

export function loadCourses(): LocalCourse[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

export function saveCourses(list: LocalCourse[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

// Profile icon
const ICON_KEY = 'slp_profile_icon'
export function loadProfileIcon(): string | null {
  return localStorage.getItem(ICON_KEY)
}
export function saveProfileIcon(base64: string) {
  localStorage.setItem(ICON_KEY, base64)
}
export function clearProfileIcon() {
  localStorage.removeItem(ICON_KEY)
}

// Quick drills per subject (editable inline in Study Sessions)
export function loadDrills(subject: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(`slp_drills_${subject}`)
    if (raw != null) return JSON.parse(raw)
  } catch { /* corrupted — fall through to defaults */ }
  return defaults
}
export function saveDrills(subject: string, list: string[]) {
  localStorage.setItem(`slp_drills_${subject}`, JSON.stringify(list))
}
