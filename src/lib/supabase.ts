import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL      as string
// Anon/publishable key — safe in browser. Works for tables with RLS disabled.
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnon)

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
