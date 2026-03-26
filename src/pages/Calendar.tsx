import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, type CaseRow, type AssignmentType } from '../lib/supabase'
import { loadCourses, type LocalCourse } from '../lib/courses'

// ── Local assignment type (stored in localStorage, no Supabase RLS issues) ──
export type LocalAssignment = {
  id: string
  title: string
  type: AssignmentType
  due_date: string
  course_id: string | null
  notes: string | null
  completed?: boolean
}

const LS_KEY = 'slp_assignments'

function loadAssignments(): LocalAssignment[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}
function saveAssignments(list: LocalAssignment[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

type CalEvent = {
  date: string
  label: string
  color: 'final' | 'midterm' | 'quiz' | 'assignment' | 'hook' | 'reading'
  assignmentId?: string   // links back to LocalAssignment for edit/delete
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const EVENT_STYLE: Record<CalEvent['color'], string> = {
  final:      'bg-error text-on-error',
  midterm:    'bg-[#b45309] text-white',
  quiz:       'bg-tertiary text-on-tertiary',
  assignment: 'bg-secondary text-on-secondary',
  hook:       'bg-primary text-on-primary',
  reading:    'bg-secondary-container text-on-secondary-container',
}
const EVENT_DOT: Record<CalEvent['color'], string> = {
  final:      'bg-error',
  midterm:    'bg-[#b45309]',
  quiz:       'bg-tertiary',
  assignment: 'bg-secondary',
  hook:       'bg-primary',
  reading:    'bg-secondary-container',
}

const ASSIGNMENT_TYPES: { value: AssignmentType; label: string }[] = [
  { value: 'midterm',    label: 'Midterm'       },
  { value: 'final',      label: 'Final Exam'    },
  { value: 'quiz',       label: 'Quiz / Problem Set' },
  { value: 'assignment', label: 'Assignment'    },
  { value: 'reading',    label: 'Reading Due'   },
]

function weekToDate(courseCreated: string, weekNum: number): string {
  const created = new Date(courseCreated)
  const day = created.getDay()
  const monday = new Date(created)
  monday.setDate(created.getDate() - (day === 0 ? 6 : day - 1))
  monday.setDate(monday.getDate() + (weekNum - 1) * 7)
  return monday.toISOString().slice(0, 10)
}

// ── Calendar export helpers ───────────────────────────────────────────────
function toICSDate(dateStr: string) { return dateStr.replace(/-/g, '') }

function buildICS(events: Array<{ title: string; date: string; notes?: string | null }>) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SeniorLawPartner//EN', 'CALSCALE:GREGORIAN',
  ]
  for (const ev of events) {
    const d = toICSDate(ev.date)
    const next = toICSDate(new Date(new Date(ev.date).getTime() + 86_400_000).toISOString().slice(0, 10))
    lines.push('BEGIN:VEVENT', `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${ev.title}`, ...(ev.notes ? [`DESCRIPTION:${ev.notes}`] : []), 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function downloadICS(icsContent: string, filename = 'calendar.ics') {
  const blob = new Blob([icsContent], { type: 'text/calendar' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function googleCalendarUrl(title: string, date: string, notes?: string | null) {
  const d = toICSDate(date)
  const next = toICSDate(new Date(new Date(date).getTime() + 86_400_000).toISOString().slice(0, 10))
  const params = new URLSearchParams({ text: title, dates: `${d}/${next}`, ...(notes ? { details: notes } : {}) })
  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`
}

const seniorPartner = () => (window as any).seniorPartner

/* ─── Add Assignment Modal ───────────────────────────────────────────────── */
function AddAssignmentModal({ courses, onAdd, onClose }: { courses: LocalCourse[]; onAdd: (a: LocalAssignment) => void; onClose: () => void }) {
  const [title,    setTitle]    = useState('')
  const [type,     setType]     = useState<AssignmentType>('midterm')
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [dueDate,  setDueDate]  = useState('')
  const [notes,    setNotes]    = useState('')

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const newItem: LocalAssignment = {
      id:        crypto.randomUUID(),
      title,
      type,
      due_date:  dueDate,
      course_id: courseId || null,
      notes:     notes || null,
    }
    onAdd(newItem)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-[var(--shadow-modal)] overflow-hidden border border-outline-variant/20">
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <h2 className="font-serif text-3xl font-medium text-on-surface">Add Event</h2>
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Type</label>
              <div className="grid grid-cols-3 gap-2">
                {ASSIGNMENT_TYPES.map((t) => (
                  <button
                    key={t.value} type="button"
                    onClick={() => setType(t.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                      type === t.value ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Title *</label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Contracts Midterm Exam"
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Due Date *</label>
                <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Course</label>
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all"
                >
                  <option value="">— No course —</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Coverage, room, % of grade…"
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 bg-white text-primary border border-primary-container rounded-full py-3 font-bold text-sm hover:bg-stone-50 transition-all">
                Cancel
              </button>
              <button type="submit"
                className="flex-1 bg-primary text-on-primary rounded-full py-3 font-bold text-sm hover:opacity-90 transition-all">
                Add Event
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ─── Edit Assignment Modal ──────────────────────────────────────────────── */
function EditAssignmentModal({ assignment, courses, onSave, onClose }: {
  assignment: LocalAssignment
  courses: LocalCourse[]
  onSave: (updated: LocalAssignment) => void
  onClose: () => void
}) {
  const [title,    setTitle]    = useState(assignment.title)
  const [type,     setType]     = useState<AssignmentType>(assignment.type)
  const [courseId, setCourseId] = useState(assignment.course_id ?? '')
  const [dueDate,  setDueDate]  = useState(assignment.due_date)
  const [notes,    setNotes]    = useState(assignment.notes ?? '')

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    onSave({ ...assignment, title, type, course_id: courseId || null, due_date: dueDate, notes: notes || null })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-[var(--shadow-modal)] overflow-hidden border border-outline-variant/20">
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <h2 className="font-serif text-3xl font-medium text-on-surface">Edit Event</h2>
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Type</label>
              <div className="grid grid-cols-3 gap-2">
                {ASSIGNMENT_TYPES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setType(t.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${type === t.value ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Title *</label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Due Date *</label>
                <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Course</label>
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all">
                  <option value="">— No course —</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Coverage, room, % of grade…"
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 text-sm outline-none border border-transparent focus:border-primary transition-all" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 bg-white text-primary border border-primary-container rounded-full py-3 font-bold text-sm hover:bg-stone-50 transition-all">Cancel</button>
              <button type="submit"
                className="flex-1 bg-primary text-on-primary rounded-full py-3 font-bold text-sm hover:opacity-90 transition-all">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ─── Day Detail Modal ───────────────────────────────────────────────────── */
function DayDetailModal({ dateStr, events, assignments, onEdit, onDelete, onComplete, onClose }: {
  dateStr:     string
  events:      CalEvent[]
  assignments: LocalAssignment[]
  onEdit:      (a: LocalAssignment) => void
  onDelete:    (id: string) => void
  onComplete:  (id: string) => void
  onClose:     () => void
}) {
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-xl shadow-[var(--shadow-modal)] border border-outline-variant/20 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-outline-variant/10 bg-surface-container-low">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Events</p>
            <h3 className="font-serif text-xl text-on-surface">{label}</h3>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-sm text-on-surface-variant italic text-center py-6">No events on this day.</p>
          ) : (
            events.map((ev, i) => {
              const assignment = assignments.find((a) => a.id === ev.assignmentId)
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-surface-container-low border border-outline-variant/10">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${EVENT_DOT[ev.color]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface leading-tight">{ev.label}</p>
                    <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mt-0.5">
                      {ev.color === 'reading' ? 'Reading' : ev.color === 'hook' ? '★ Prof. Hook' : ev.color.charAt(0).toUpperCase() + ev.color.slice(1)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {assignment && (
                      <button onClick={() => { onComplete(assignment.id); onClose() }} title="Mark complete"
                        className="p-1.5 text-on-surface-variant hover:text-green-600 transition-colors rounded-lg hover:bg-green-50">
                        <span className="material-symbols-outlined text-base">check_circle</span>
                      </button>
                    )}
                    {assignment && (
                      <button onClick={() => { onEdit(assignment); onClose() }} title="Edit"
                        className="p-1.5 text-on-surface-variant hover:text-primary transition-colors rounded-lg hover:bg-primary/5">
                        <span className="material-symbols-outlined text-base">edit</span>
                      </button>
                    )}
                    <button
                      onClick={() => (window as any).seniorPartner?.openExternalUrl?.(googleCalendarUrl(ev.label, ev.date, assignment?.notes))}
                      title="Add to Google Calendar"
                      className="p-1.5 text-on-surface-variant hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50">
                      <span className="material-symbols-outlined text-base">event</span>
                    </button>
                    {assignment && (
                      <button onClick={() => { onDelete(assignment.id); onClose() }} title="Delete"
                        className="p-1.5 text-on-surface-variant hover:text-error transition-colors rounded-lg hover:bg-red-50">
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Calendar Page ──────────────────────────────────────────────────────── */
export function Calendar() {
  const today = new Date()
  const [year,           setYear]           = useState(today.getFullYear())
  const [month,          setMonth]          = useState(today.getMonth())
  const [showAddModal,   setShowAddModal]   = useState(false)
  const [editTarget,     setEditTarget]     = useState<LocalAssignment | null>(null)
  const [selectedDayStr, setSelectedDayStr] = useState<string | null>(null)
  const [assignments,    setAssignments]    = useState<LocalAssignment[]>(loadAssignments)

  const addAssignment = useCallback((a: LocalAssignment) => {
    setAssignments((prev) => {
      const next = [...prev, a].sort((x, y) => x.due_date.localeCompare(y.due_date))
      saveAssignments(next)
      return next
    })
  }, [])

  const editAssignment = useCallback((updated: LocalAssignment) => {
    setAssignments((prev) => {
      const next = prev.map((a) => a.id === updated.id ? updated : a)
        .sort((x, y) => x.due_date.localeCompare(y.due_date))
      saveAssignments(next)
      return next
    })
  }, [])

  const deleteAssignment = useCallback((id: string) => {
    setAssignments((prev) => {
      const next = prev.filter((a) => a.id !== id)
      saveAssignments(next)
      return next
    })
  }, [])

  const markComplete = useCallback((id: string) => {
    setAssignments((prev) => {
      const next = prev.map((a) => a.id === id ? { ...a, completed: true } : a)
      saveAssignments(next)
      return next
    })
  }, [])

  function exportAllICS() {
    const events = assignments
      .filter((a) => !a.completed)
      .map((a) => ({ title: a.title, date: a.due_date, notes: a.notes }))
    downloadICS(buildICS(events), 'senior-law-partner.ics')
  }

  const [courses] = useState<LocalCourse[]>(loadCourses)

  const { data: cases = [] } = useQuery<CaseRow[]>({
    queryKey: ['cases-calendar'],
    queryFn: async () => {
      const { data } = await supabase.from('cases').select('*').eq('user_id', BIANNA_USER_ID)
      return (data ?? []) as CaseRow[]
    },
  })

  // Build events from all sources (exclude completed — they're checked off)
  const events: CalEvent[] = []

  for (const a of assignments) {
    if (a.completed) continue
    events.push({ date: a.due_date, label: a.title, color: a.type as CalEvent['color'], assignmentId: a.id })
  }

  // Course exam_date (legacy / manually set in Settings)
  for (const c of courses) {
    if (c.exam_date) {
      const alreadyHave = assignments.some((a) => a.course_id === c.id && a.type === 'final')
      if (!alreadyHave) {
        events.push({ date: c.exam_date, label: `${c.name} — Final`, color: 'final' })
      }
    }
  }

  // Cases reading schedule
  for (const cas of cases) {
    if (cas.week_number == null) continue
    const course = courses.find((c) => c.id === cas.course_id)
    if (!course) continue
    events.push({
      date:  weekToDate(course.created_at, cas.week_number),
      label: cas.case_name,
      color: cas.is_professor_hook ? 'hook' : 'reading',
    })
  }

  // Build grid
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function eventsForDay(d: number): CalEvent[] {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return events.filter((e) => e.date === ds)
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  const todayStr = today.toISOString().slice(0, 10)

  return (
    <>
      {showAddModal && <AddAssignmentModal courses={courses} onAdd={addAssignment} onClose={() => setShowAddModal(false)} />}
      {editTarget && <EditAssignmentModal assignment={editTarget} courses={courses} onSave={editAssignment} onClose={() => setEditTarget(null)} />}
      {selectedDayStr && (
        <DayDetailModal
          dateStr={selectedDayStr}
          events={events.filter((e) => e.date === selectedDayStr)}
          assignments={assignments}
          onEdit={(a) => setEditTarget(a)}
          onDelete={deleteAssignment}
          onComplete={markComplete}
          onClose={() => setSelectedDayStr(null)}
        />
      )}

      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex items-end justify-between">
          <div>
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">Schedule</span>
            <h1 className="text-4xl font-serif mt-1 text-primary">Calendar</h1>
            <p className="text-sm text-on-surface-variant mt-1">Exam dates auto-fill from syllabi. Add midterms, quizzes, and finals manually.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportAllICS}
              title="Export to Apple Calendar (.ics)"
              className="flex items-center gap-1.5 py-2 px-4 border border-outline-variant/30 text-on-surface-variant rounded-full text-xs font-label font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-sm">apple</span>
              Export .ics
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 py-2 px-5 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Add Event
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-[10px] font-label uppercase tracking-wider">
          {([
            ['final',      'Final Exam'],
            ['midterm',    'Midterm'],
            ['quiz',       'Quiz / Problem Set'],
            ['assignment', 'Assignment'],
            ['hook',       'Prof. Hook Case'],
            ['reading',    'Reading Due'],
          ] as [CalEvent['color'], string][]).map(([color, label]) => (
            <span key={color} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${EVENT_DOT[color]}`} />
              {label}
            </span>
          ))}
        </div>

        {/* Month nav + grid */}
        <div className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10 bg-surface-container-low">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors">
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <h2 className="font-serif text-xl text-primary">{MONTH_NAMES[month]} {year}</h2>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors">
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-outline-variant/10">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              const dayEvents = day ? eventsForDay(day) : []
              const cellDate  = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
              const isToday   = cellDate === todayStr

              return (
                <div
                  key={i}
                  onClick={() => day && setSelectedDayStr(cellDate)}
                  className={`min-h-[88px] p-1.5 border-b border-r border-outline-variant/10 ${
                    !day ? 'bg-surface-container/20' : isToday ? 'bg-primary-fixed/15' : 'cursor-pointer hover:bg-surface-container/40 transition-colors'
                  }`}
                >
                  {day && (
                    <>
                      <span className={`text-xs font-bold inline-flex items-center justify-center w-6 h-6 rounded-full mb-1 ${
                        isToday ? 'bg-primary text-on-primary' : 'text-on-surface-variant'
                      }`}>
                        {day}
                      </span>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map((ev, j) => (
                          <div
                            key={j}
                            className={`text-[9px] font-bold px-1 py-0.5 rounded truncate leading-tight ${EVENT_STYLE[ev.color]}`}
                            title={ev.label}
                          >
                            {ev.label}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[9px] text-on-surface-variant pl-1">+{dayEvents.length - 3}</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Upcoming list */}
        <div>
          <h2 className="font-serif text-xl text-primary mb-4">Upcoming</h2>
          {events.filter((e) => e.date >= todayStr).length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl text-outline-variant">event_available</span>
              <p className="text-sm">No upcoming events. Add a midterm or final, or import a syllabus in Reading Tracker.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {events
                .filter((e) => e.date >= todayStr)
                .sort((a, b) => a.date.localeCompare(b.date))
                .slice(0, 12)
                .map((ev, i) => {
                  const assignment = assignments.find((a) => a.title === ev.label && a.due_date === ev.date && !a.completed)
                  return (
                    <div key={i} className="flex items-center gap-4 bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10 group">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${EVENT_DOT[ev.color]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{ev.label}</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5 uppercase tracking-wider">
                          {ev.color === 'reading' ? 'Reading' : ev.color === 'hook' ? '★ Prof. Hook' : ev.color.charAt(0).toUpperCase() + ev.color.slice(1)}
                        </p>
                      </div>
                      <span className="text-xs text-on-surface-variant font-mono shrink-0">
                        {new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      {/* Action buttons — visible on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Mark complete */}
                        {assignment && (
                          <button onClick={() => markComplete(assignment.id)} title="Mark complete"
                            className="p-1.5 text-on-surface-variant hover:text-green-600 transition-colors">
                            <span className="material-symbols-outlined text-base">check_circle</span>
                          </button>
                        )}
                        {/* Edit */}
                        {assignment && (
                          <button onClick={() => setEditTarget(assignment)} title="Edit event"
                            className="p-1.5 text-on-surface-variant hover:text-primary transition-colors">
                            <span className="material-symbols-outlined text-base">edit</span>
                          </button>
                        )}
                        {/* Export to Google Calendar */}
                        <button
                          onClick={() => seniorPartner()?.openExternalUrl?.(googleCalendarUrl(ev.label, ev.date, assignment?.notes))}
                          title="Add to Google Calendar"
                          className="p-1.5 text-on-surface-variant hover:text-blue-600 transition-colors"
                        >
                          <span className="material-symbols-outlined text-base">event</span>
                        </button>
                        {/* Delete */}
                        {assignment && (
                          <button onClick={() => deleteAssignment(assignment.id)} title="Delete event"
                            className="p-1.5 text-on-surface-variant hover:text-error transition-colors">
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
