import { createClient } from '@supabase/supabase-js'

// ─── Environment ─────────────────────────────────────────────────────────────
// `?? ''` is load-bearing, not defensive noise. Vite inlines these at BUILD time, and
// when they are absent the bundled text is literally `createClient(void 0, void 0)`.
// supabase-js validates the URL in its constructor -- `if (!t) throw Error(
// "supabaseUrl is required.")` -- and this call sits at module scope, so the throw
// happens while the bundle is still being evaluated. `createRoot().render()` in
// main.tsx therefore never runs: #root stays empty and the window stays white, while
// `did-finish-load` (HTML parsed) and even `ready-to-show` (the window's
// backgroundColor hands Electron an initial paint) both still fire. That combination
// is why three DMGs shipped blank and why every renderer-liveness check said "fine".
//
// Coercing to '' keeps the value falsy-but-present so the guard below can substitute
// an obviously fake host, turning a boot-killing throw into an app that boots
// unconfigured and saves to the local Vault.
const supabaseUrl  = (import.meta.env.VITE_SUPABASE_URL      as string | undefined)?.trim() ?? ''
// Anon/publishable key — safe in browser. Works for tables with RLS disabled.
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

/**
 * False when the build had no Supabase credentials inlined.
 *
 * Callers use this to answer honestly instead of optimistically: a page can skip the
 * request entirely and go straight to local storage, rather than firing a call that
 * can only fail and then reporting a network error for a configuration problem.
 */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnon.length > 0

/**
 * A syntactically valid placeholder, never a real host.
 *
 * supabase-js requires an http(s) URL and a non-empty key, so these satisfy the
 * constructor while `.invalid` (RFC 2606) guarantees that any request which somehow
 * still fires fails at DNS resolution instead of at import. Without this, an
 * unconfigured build is a build that cannot start at all.
 */
const SAFE_URL = supabaseUrl || 'https://unconfigured.supabase.invalid'
const SAFE_KEY = supabaseAnon || 'unconfigured-anon-key'

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not present at build ' +
    'time, so the app is running without cloud sync. The Document Vault saves locally ' +
    'and offers Word/PDF export instead. To enable sync, put both values in .env.local ' +
    '(see .env.example) and rebuild.',
  )
}

export const supabase = createClient(SAFE_URL, SAFE_KEY)

// Single-user app — no auth wall. All data belongs to Bianna.
export const BIANNA_USER_ID = '00000000-0000-0000-0000-000000000001'

/* ─── Row-level types ─────────────────────────────────────────────────────
   Mirrors the Supabase schema. Used in page components for type safety
   without needing the generated SDK types.
   ───────────────────────────────────────────────────────────────────────── */
export type CourseRow = {
  id: string; user_id: string; name: string
  professor: string | null; exam_date: string | null
  semester: string | null;  created_at: string
}

export type CaseRow = {
  id: string; user_id: string; course_id: string
  case_name: string; doctrine_area: string | null
  week_number: number | null; reading_order: number | null
  status: 'unread' | 'in_progress' | 'read'
  is_professor_hook: boolean; outline_generated: boolean
  notes: string | null; date_read: string | null; created_at: string
}

export type DocumentRow = {
  id: string; user_id: string; subject: string; mode: string
  topic: string; html_content: string; pdf_url: string | null; created_at: string
}

export type CaptureRow = {
  id: string; user_id: string; file_url: string | null
  extracted_text: string; detected_type: string
  action_taken: string | null; created_at: string
}

export type AssignmentType = 'midterm' | 'final' | 'quiz' | 'assignment' | 'reading'

export type AssignmentRow = {
  id: string; user_id: string; course_id: string | null
  title: string; type: AssignmentType
  due_date: string; notes: string | null; created_at: string
}
