/* ─── Supabase Database Type Definitions ─────────────────────────────────
   Mirrors the schema from the Senior Law Partner product spec.
   Run `npx supabase gen types typescript` later to auto-generate from live DB.
   ───────────────────────────────────────────────────────────────────────── */

export type CaseStatus = 'unread' | 'in_progress' | 'read'
export type DocumentMode = 'full_outline' | 'case_brief' | 'irac_memo' | 'checklist_audit' | 'flash_card' | 'custom'
export type DocumentSubject = 'contracts' | 'torts' | 'civ_pro' | 'constitutional' | 'property' | 'other'
export type CaptureAction = 'outline' | 'case_brief' | 'tracker' | 'irac_drill' | 'checklist' | 'chat'
export type SessionMode = 'socratic' | 'irac_full' | 'grade' | 'exam_prep'

export interface Database {
  public: {
    Tables: {
      courses: {
        Row: {
          id: string
          user_id: string
          name: string
          professor: string | null
          exam_date: string | null
          semester: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['courses']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['courses']['Insert']>
      }
      cases: {
        Row: {
          id: string
          user_id: string
          course_id: string
          case_name: string
          doctrine_area: string | null
          week_number: number | null
          reading_order: number | null
          status: CaseStatus
          is_professor_hook: boolean
          outline_generated: boolean
          notes: string | null
          date_read: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['cases']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['cases']['Insert']>
      }
      documents: {
        Row: {
          id: string
          user_id: string
          subject: DocumentSubject
          mode: DocumentMode
          topic: string
          html_content: string
          pdf_url: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['documents']['Insert']>
      }
      captures: {
        Row: {
          id: string
          user_id: string
          file_url: string | null
          extracted_text: string
          detected_type: 'notes' | 'syllabus' | 'case_printout' | 'checklist' | 'unknown'
          action_taken: CaptureAction | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['captures']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['captures']['Insert']>
      }
      sessions: {
        Row: {
          id: string
          user_id: string
          subject: DocumentSubject
          mode: SessionMode
          messages: Array<{ role: 'user' | 'assistant'; content: string }>
          irac_scores: { issue: number; rule: number; analysis: number; conclusion: number } | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sessions']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>
      }
      usage: {
        Row: {
          id: string
          user_id: string
          tokens_used: number
          cost_usd: number
          endpoint: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['usage']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['usage']['Insert']>
      }
    }
  }
}
