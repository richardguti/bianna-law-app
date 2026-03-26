import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase, BIANNA_USER_ID, type DocumentRow, type CaseRow } from '../lib/supabase'
import { loadCourses, type LocalCourse } from '../lib/courses'

type LocalAssignment = { id: string; title: string; type: string; due_date: string; notes: string | null }

const EVENT_DOT: Record<string, string> = {
  final:      'bg-red-500',
  midterm:    'bg-orange-600',
  quiz:       'bg-teal-500',
  assignment: 'bg-secondary',
  reading:    'bg-secondary-container',
}

/* ─── Stat Card ──────────────────────────────────────────────────────────── */
function StatCard({ label, value, badge, sub }: { label: string; value: string | number; badge?: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/10 shadow-[var(--shadow-sm)]">
      <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">{label}</p>
      <div className="flex items-end justify-between mt-3">
        <span className="text-4xl font-serif text-primary">{value}</span>
        {badge && (
          <span className="text-xs font-bold text-primary bg-primary-container/30 px-2 py-1 rounded mb-0.5">
            {badge}
          </span>
        )}
        {sub}
      </div>
    </div>
  )
}

/* ─── Progress Bar ───────────────────────────────────────────────────────── */
function ProgressBar({ label, pct, count }: { label: string; pct: number; count: string }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="font-bold text-sm text-on-surface">{label}</span>
        <span className="text-sm text-on-surface-variant">{count}</span>
      </div>
      <div className="w-full h-3 bg-surface-container-low rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ─── Per-course progress bar (queries Supabase for real counts) ─────────── */
function CourseProgressBar({ course }: { course: LocalCourse }) {
  const { data } = useQuery({
    queryKey: ['course-cases', course.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('cases')
        .select('status')
        .eq('user_id', BIANNA_USER_ID)
        .eq('course_id', course.id)
      return (data ?? []) as { status: string }[]
    },
  })
  const total = data?.length ?? 0
  const read  = data?.filter((c) => c.status === 'read').length ?? 0
  const pct   = total ? Math.round((read / total) * 100) : 0
  return <ProgressBar label={course.name} pct={pct} count={`${read} / ${total} cases`} />
}

export function Dashboard() {
  const navigate = useNavigate()

  /* Calendar events from localStorage */
  const [upcomingEvents, setUpcomingEvents] = useState<LocalAssignment[]>([])
  useEffect(() => {
    try {
      const all: LocalAssignment[] = JSON.parse(localStorage.getItem('slp_assignments') ?? '[]')
      const today = new Date().toISOString().slice(0, 10)
      setUpcomingEvents(all.filter((a) => a.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5))
    } catch { /* ignore */ }
  }, [])

  /* Reading progress per course — deduplicate by name */
  const [courses] = useState<LocalCourse[]>(() => {
    const all = loadCourses()
    const seen = new Set<string>()
    return all.filter((c) => {
      const key = c.name.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  /* Completion stats derived from localStorage assignments */
  const [localStats] = useState(() => {
    try {
      const all: Array<{ completed?: boolean; due_date: string }> =
        JSON.parse(localStorage.getItem('slp_assignments') ?? '[]')
      const total     = all.length
      const completed = all.filter((a) => a.completed).length
      const today     = new Date().toISOString().slice(0, 10)
      const weekAgo   = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
      const doneThisWeek = all.filter((a) => a.completed && a.due_date >= weekAgo && a.due_date <= today).length
      return {
        semesterPct:    total ? Math.round((completed / total) * 100) : 0,
        doneThisWeek,
      }
    } catch { return { semesterPct: 0, doneThisWeek: 0 } }
  })

  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [casesRes, docsRes] = await Promise.all([
        supabase.from('cases').select('status, date_read').eq('user_id', BIANNA_USER_ID),
        supabase.from('documents').select('id').eq('user_id', BIANNA_USER_ID),
      ])

      const cases    = (casesRes.data ?? []) as Pick<CaseRow, 'status' | 'date_read'>[]
      const weekAgo  = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const thisWeek = cases.filter((c) => c.date_read && c.date_read >= weekAgo).length

      return {
        casesThisWeek: thisWeek,
        outlines:      docsRes.data?.length ?? 0,
        streak:        0,
      }
    },
  })

  const { data: recentDocs = [] } = useQuery<Pick<DocumentRow, 'id' | 'topic' | 'subject' | 'mode' | 'created_at'>[]>({
    queryKey: ['recent-docs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('documents')
        .select('id, topic, subject, mode, created_at')
        .eq('user_id', BIANNA_USER_ID)
        .order('created_at', { ascending: false })
        .limit(5)
      return (data ?? []) as Pick<DocumentRow, 'id' | 'topic' | 'subject' | 'mode' | 'created_at'>[]
    },
  })

  const MODE_LABELS: Record<string, string> = {
    full_outline:    'Full Outline',
    case_brief:      'Case Brief',
    irac_memo:       'IRAC Memo',
    checklist_audit: 'Checklist Audit',
    flash_card:      'Flash Card',
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">
            Workspace Overview
          </span>
          <h1 className="text-5xl font-serif mt-2 text-primary">Welcome back, Partner.</h1>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant bg-surface-container-low px-4 py-2 rounded-lg">
          <span className="material-symbols-outlined text-lg">calendar_today</span>
          <span>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Cases read this week" value={stats?.casesThisWeek ?? localStats.doneThisWeek} badge={localStats.doneThisWeek > 0 ? `+${localStats.doneThisWeek}` : '+0'} />
        <StatCard label="Outlines generated"   value={stats?.outlines ?? '—'} />
        <StatCard
          label="Semester completion"
          value={`${localStats.semesterPct}%`}
          sub={
            <div className="w-16 h-1.5 bg-secondary-container rounded-full overflow-hidden mb-2">
              <div className="h-full bg-primary rounded-full" style={{ width: `${localStats.semesterPct}%` }} />
            </div>
          }
        />
        <StatCard
          label="Streak"
          value={stats?.streak ?? 0}
          sub={
            <div className="flex items-center gap-1 mb-1">
              <span className="material-symbols-outlined text-primary filled" style={{ fontSize: 20 }}>local_fire_department</span>
              <span className="text-xs font-medium text-on-surface-variant">Days</span>
            </div>
          }
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Reading progress */}
        <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-8 shadow-[var(--shadow-sm)] border border-outline-variant/10">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-serif text-primary">Reading Progress</h2>
            <button
              onClick={() => navigate('/tracker')}
              className="text-xs font-label uppercase tracking-widest font-bold text-on-surface-variant hover:text-primary transition-colors"
            >
              View Full Tracker →
            </button>
          </div>
          {courses.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl">menu_book</span>
              <p className="text-sm">No courses yet. <button onClick={() => navigate('/settings')} className="text-primary underline">Add a course</button> to start tracking.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {courses.map((c) => (
                <CourseProgressBar key={c.id} course={c} />
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-4 space-y-6">
          {/* Recent outlines */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-[var(--shadow-sm)] border border-outline-variant/10">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-serif text-primary">Recent Outlines</h2>
              <button onClick={() => navigate('/outline')} className="text-xs font-label uppercase tracking-widest font-bold text-primary">New →</button>
            </div>
            {recentDocs.length === 0 ? (
              <p className="text-sm text-on-surface-variant italic">No outlines yet.</p>
            ) : (
              <div className="space-y-3">
                {recentDocs.map((doc) => (
                  <div key={doc.id} className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-primary-container text-base mt-0.5">description</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{doc.topic}</p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-[10px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">
                          {doc.subject}
                        </span>
                        <span className="text-[10px] text-on-surface-variant">
                          {MODE_LABELS[doc.mode] ?? doc.mode}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick IRAC Grader */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-[var(--shadow-sm)] border border-outline-variant/10">
            <h2 className="text-lg font-serif text-primary mb-4">Quick Grade</h2>
            <p className="text-xs text-on-surface-variant mb-3">Paste an IRAC answer for instant scoring.</p>
            <button
              onClick={() => navigate('/sessions')}
              className="w-full py-3 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
            >
              Open Study Sessions →
            </button>
          </div>
        </div>
      </div>

      {/* Upcoming calendar events */}
      <div className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-[var(--shadow-sm)]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-serif text-primary">Upcoming Events</h2>
          <button onClick={() => navigate('/calendar')} className="text-xs font-label uppercase tracking-widest font-bold text-primary hover:opacity-70 transition-opacity">
            View Calendar →
          </button>
        </div>
        {upcomingEvents.length === 0 ? (
          <p className="text-sm text-on-surface-variant italic py-4 text-center">No upcoming events — <button onClick={() => navigate('/calendar')} className="text-primary underline">add one in Calendar</button>.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${EVENT_DOT[ev.type] ?? 'bg-secondary'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">{ev.title}</p>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mt-0.5">
                    {ev.type} · {new Date(ev.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick capture */}
      <div
        onClick={() => navigate('/capture')}
        className="bg-surface-container-lowest rounded-xl p-8 border-2 border-dashed border-outline-variant/40 hover:border-primary/40 transition-colors cursor-pointer flex flex-col items-center gap-3 text-center"
      >
        <span className="material-symbols-outlined text-primary text-4xl">edit_note</span>
        <p className="font-serif text-lg text-primary">Quick Capture</p>
        <p className="text-sm text-on-surface-variant">
          Photograph notes, a whiteboard, or a case printout → extract text → AI action
        </p>
      </div>
    </div>
  )
}
