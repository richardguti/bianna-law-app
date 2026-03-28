import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, type CaseRow } from '../lib/supabase'
import { loadCourses, saveCourses, type LocalCourse } from '../lib/courses'
import { useAppStore } from '../store/appStore'
import { CLAUDE_URL, claudeHeaders } from '../lib/claude'

// Reuse the localStorage assignment key from Calendar
const LS_ASSIGNMENTS_KEY = 'slp_assignments'
type LocalAssignmentEntry = { id: string; title: string; type: string; due_date: string; course_id: string | null; notes: string | null }
function appendAssignments(newEntries: LocalAssignmentEntry[]) {
  try {
    const existing: LocalAssignmentEntry[] = JSON.parse(localStorage.getItem(LS_ASSIGNMENTS_KEY) ?? '[]')
    localStorage.setItem(LS_ASSIGNMENTS_KEY, JSON.stringify([...existing, ...newEntries]))
  } catch { /* ignore */ }
}

type CaseStatus = 'unread' | 'in_progress' | 'read'

const STATUS_CYCLE: Record<CaseStatus, CaseStatus> = {
  unread:      'in_progress',
  in_progress: 'read',
  read:        'unread',
}

const STATUS_STYLE: Record<CaseStatus, string> = {
  unread:      'bg-error-container   text-on-error-container',
  in_progress: 'bg-tertiary-fixed/60 text-on-tertiary-container',
  read:        'bg-primary-fixed     text-on-primary-container',
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  unread:      'Unread',
  in_progress: 'In Progress',
  read:        'Read ✓',
}

/* ─── Syllabus Parse prompt ──────────────────────────────────────────────── */
const PARSE_SYSTEM = `Extract a structured course reading list from the provided law school document. This may be a full syllabus OR a reading checklist — handle both.
Respond ONLY with valid JSON (no markdown fences):
{
  "courseName": "...",
  "professor": "...",
  "semester": "...",
  "assignments": [
    {"title":"Midterm Exam","type":"midterm","dueDate":"YYYY-MM-DD"}
  ],
  "cases": [{"week":1,"date":"YYYY-MM-DD","caseName":"...","doctrineArea":"...","isProfessorHook":false}]
}
Rules:
- Extract "courseName" from the document title or header (e.g. "CONSTITUTIONAL LAW READING CHECKLIST" → "Constitutional Law", "CRIMINAL LAW READING CHECKLIST" → "Criminal Law", "PROPERTY READING CHECKLIST" → "Property").
- "professor" and "semester" may be null if not present (reading checklists often omit them).
- "type" must be one of: midterm, final, quiz, assignment, reading.
- Extract ALL graded events (exams, quizzes, papers) into "assignments". Reading checklists may have none — use [].
- For EACH dated reading entry, create a "cases" entry. Use the page range or description as "caseName" and the weekly topic as "doctrineArea".
- Include the EXACT dates from the document (e.g. "Jan. 12" → "2026-01-12", "Jan. 14" → "2026-01-14"). Spring 2026 semester.
- "caseName" must be descriptive: include page range AND case names if listed (e.g. "Pages 1–37 (Marbury v. Madison, Martin v. Hunter's Lessee)").
- Skip "NO CLASS" entries — do not add them as cases.
- "cases" must never be null — use [] only if the document has truly zero content.`

///////////////////////////////////////////////////////////
// Calendar ICS Helper
///////////////////////////////////////////////////////////
function generateICSAndDownload(parsed: any) {
  let icsEvents = ''
  
  if (parsed.cases) {
    parsed.cases.forEach((c: any) => {
      if (!c.date) return
      const dateStr = c.date.replace(/-/g, '') // YYYYMMDD
      icsEvents += [
        'BEGIN:VEVENT',
        `DTSTART;VALUE=DATE:${dateStr}`,
        `SUMMARY:📖 ${c.caseName.substring(0, 60)}`,
        'BEGIN:VALARM',
        'TRIGGER:-PT10H', // Reminder 10 hours before
        'DESCRIPTION:Law School Reading Reminder',
        'ACTION:DISPLAY',
        'END:VALARM',
        'END:VEVENT'
      ].join('\n') + '\n'
    })
  }

  const icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\n${icsEvents}END:VCALENDAR`
  const blob = new Blob([icsContent], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Syllabus_${parsed.courseName?.replace(/\\s+/g, '_') ?? 'Readings'}.ics`
  a.click()
  URL.revokeObjectURL(url)
}

export function ReadingTracker() {
  const qc      = useQueryClient()
  const apiKey  = useAppStore((s) => s.apiKey)

  const [syllabusText,   setSyllabusText]   = useState('')
  const [parsing,        setParsing]        = useState(false)
  const [parseError,     setParseError]     = useState<string | null>(null)
  const [attachedFile,   setAttachedFile]   = useState<string | null>(null)
  const [attachLoading,  setAttachLoading]  = useState(false)

  async function handleAttachFile() {
    setAttachLoading(true)
    try {
      const result = await (window as any).seniorPartner?.pickAndReadFile?.()
      if (!result || result.canceled) return
      if (!result.success) { setParseError(result.error ?? 'Could not read file.'); return }
      setSyllabusText(result.text)
      setAttachedFile(result.fileName)
      setParseError(null)
    } finally {
      setAttachLoading(false)
    }
  }
  const [filterStatus, setFilterStatus] = useState<CaseStatus | 'all'>('all')
  const [filterHook,   setFilterHook]   = useState(false)
  const [activeTab,    setActiveTab]    = useState<string | null>(null)
  const [addingTab,    setAddingTab]    = useState(false)
  const [newTabName,   setNewTabName]   = useState('')

  /* Courses — localStorage, deduplicated by name */
  const [courses, setCourses] = useState<LocalCourse[]>(() => {
    const all = loadCourses()
    const seen = new Set<string>()
    return all.filter((c) => {
      const key = c.name.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  // Set first tab when courses load
  useEffect(() => {
    if (courses.length && !activeTab) setActiveTab(courses[0].id)
  }, [courses, activeTab])

  /* Cases for active tab */
  const { data: cases = [] } = useQuery<CaseRow[]>({
    queryKey: ['cases', activeTab, filterStatus, filterHook],
    enabled: !!activeTab,
    queryFn: async () => {
      let q = supabase.from('cases').select('*').eq('course_id', activeTab!)
      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      if (filterHook)             q = q.eq('is_professor_hook', true)
      const { data } = await q.order('week_number').order('reading_order')
      return (data ?? []) as CaseRow[]
    },
  })

  /* Toggle status */
  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CaseStatus }) => {
      const next = STATUS_CYCLE[status]
      await supabase.from('cases').update({
        status:    next,
        date_read: next === 'read' ? new Date().toISOString().slice(0, 10) : null,
      } as any).eq('id', id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cases'] }),
  })

  /* Parse syllabus */
  async function parseSyllabus() {
    if (!syllabusText.trim() || !apiKey) return
    setParsing(true)
    setParseError(null)

    try {
      const res = await fetch(CLAUDE_URL, {
        method: 'POST',
        headers: claudeHeaders(apiKey),
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 4096,
          system: PARSE_SYSTEM,
          messages: [{ role: 'user', content: syllabusText.slice(0, 8000) }],
        }),
      })
      const json = await res.json()
      const rawText: string = json.content[0].text
      const start = rawText.indexOf('{')
      const end   = rawText.lastIndexOf('}')
      if (start < 0 || end < start) throw new Error('Claude returned an unexpected format — could not parse syllabus JSON.')
      const parsed = JSON.parse(rawText.slice(start, end + 1))

      const parsedName: string = parsed.courseName || attachedFile?.replace(/\.(pdf|docx|txt|md)$/i, '').replace(/reading\s*checklist/i, '').replace(/_/g, ' ').trim() || 'Unknown Course'
      const finalAssignment = (parsed.assignments ?? []).find(
        (a: { type: string }) => a.type === 'final'
      )

      // Match to an existing course with similar name (avoids duplicates)
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
      const existingCourse = courses.find((c) => {
        const a = normalize(c.name); const b = normalize(parsedName)
        return a === b || a.includes(b.split(' ')[0]) || b.includes(a.split(' ')[0])
      })
      const courseId   = existingCourse?.id ?? crypto.randomUUID()
      const isNewCourse = !existingCourse

      // 1. Save course to localStorage (skip if matched existing)
      const newCourse: LocalCourse = {
        id:         courseId,
        name:       existingCourse?.name ?? parsedName,
        professor:  parsed.professor ?? existingCourse?.professor ?? null,
        exam_date:  finalAssignment?.dueDate ?? existingCourse?.exam_date ?? null,
        semester:   parsed.semester ?? existingCourse?.semester ?? 'Spring 2026',
        created_at: existingCourse?.created_at ?? new Date().toISOString(),
      }
      if (isNewCourse) {
        setCourses((prev) => { const next = [...prev, newCourse]; saveCourses(next); return next })
      } else {
        // Update existing course exam_date if we just learned it
        if (finalAssignment?.dueDate && !existingCourse?.exam_date) {
          setCourses((prev) => {
            const next = prev.map((c) => c.id === courseId ? { ...c, exam_date: finalAssignment.dueDate } : c)
            saveCourses(next); return next
          })
        }
        setActiveTab(courseId)
      }

      // Push course info to OpenClaw long-term memory so all AI features know Bianna's schedule
      ;(window as any).seniorPartner?.openClawMemoryWrite?.({
        content: `**Course:** ${newCourse.name}\n**Professor:** ${newCourse.professor ?? 'Unknown'}\n**Semester:** ${newCourse.semester}\n**Exam Date:** ${newCourse.exam_date ?? 'TBD'}\n**Cases:** ${(parsed.cases ?? []).length} readings loaded`,
        type:    'longterm',
        heading: `Course Added: ${newCourse.name}`,
      })?.catch(() => { /* silent */ })

      // 2. Save assignments to localStorage (assignments table has RLS — bypass Supabase)
      const assignmentsToInsert = (parsed.assignments ?? []).filter(
        (a: { dueDate: string | null }) => a.dueDate
      )
      if (assignmentsToInsert.length > 0) {
        appendAssignments(
          assignmentsToInsert.map((a: { title: string; type: string; dueDate: string }) => ({
            id:        crypto.randomUUID(),
            title:     a.title,
            type:      a.type,
            due_date:  a.dueDate,
            course_id: courseId,
            notes:     null,
          }))
        )
      }

      // 3. Insert cases into Supabase (cases table has RLS disabled — writes allowed)
      const casesToInsert = parsed.cases ?? []
      if (casesToInsert.length > 0) {
        await supabase.from('cases').insert(
          casesToInsert.map((c: { week: number; caseName: string; doctrineArea: string; isProfessorHook: boolean }, i: number) => ({
            user_id:           BIANNA_USER_ID,
            course_id:         courseId,
            case_name:         c.caseName,
            doctrine_area:     c.doctrineArea,
            week_number:       c.week,
            reading_order:     i,
            status:            'unread',
            is_professor_hook: c.isProfessorHook ?? false,
            outline_generated: false,
          })) as any
        )
      }

      // 4. Sync case readings into slp_assignments so Calendar shows them with exact dates
      //    Title is prefixed with course name: "Constitutional Law — Pages 1–37 (Marbury v. Madison)"
      const caseReadings = (parsed.cases ?? [])
        .filter((c: { date?: string; caseName?: string }) => c.date && c.caseName && !/no class/i.test(c.caseName))
        .map((c: { caseName: string; date: string; doctrineArea?: string }) => ({
          id:        crypto.randomUUID(),
          title:     `${newCourse.name} — ${c.caseName}`,
          type:      'reading' as const,
          due_date:  c.date,
          course_id: courseId,
          notes:     c.doctrineArea ?? null,
        }))
      if (caseReadings.length > 0) appendAssignments(caseReadings)

      // 5. Generate & download .ICS calendar file (kept as a bonus export option)
      try { generateICSAndDownload(parsed) } catch (icsErr) {
        console.warn('Failed to generate ICS:', icsErr)
      }

      // 5. Optional: sync to Google Calendar via Electron IPC
      try {
        const sp = window.seniorPartner
        if (sp?.syncGoogleCalendar) {
          const eventsList = parsed.cases
            .filter((c: any) => c.date)
            .map((c: any) => ({ date: c.date, caseName: c.caseName }))
          ;(sp.syncGoogleCalendar as (e: unknown) => Promise<{ success: boolean; count?: number; error?: string }>)(eventsList)
            .then((res) => {
              if (!res.success) console.warn('Google Calendar Sync Failed:', res.error)
              else console.log(`Google Calendar Sync: added ${res.count} events`)
            })
            .catch((err: unknown) => console.error('Google Calendar Error:', err))
        }
      } catch (gErr) { console.warn('Failed to dispatch Google Sync:', gErr) }

      qc.invalidateQueries({ queryKey: ['cases'] })
      setSyllabusText('')
    } catch (err) {
      setParseError((err as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const totalCases = cases.length
  const readCases  = cases.filter((c) => c.status === 'read').length
  const hookCases  = cases.filter((c) => c.is_professor_hook).length

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-bold">Reading Archive</span>
        <h1 className="text-4xl font-serif mt-1 text-primary">Reading Tracker</h1>
      </div>

      {/* Syllabus upload */}
      <div className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant/10 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-serif text-xl text-primary">Import Syllabus</h2>
          <button
            onClick={handleAttachFile}
            disabled={attachLoading}
            title="Attach a PDF, DOCX, TXT, or MD syllabus file"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-outline-variant/30 text-on-surface-variant rounded-full text-xs font-label hover:bg-surface-container-high transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">{attachLoading ? 'hourglass_empty' : 'attach_file'}</span>
            {attachLoading ? 'Reading…' : 'Attach File'}
          </button>
        </div>
        {attachedFile && (
          <div className="flex items-center gap-2 mb-2 text-xs text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-lg w-fit">
            <span className="material-symbols-outlined text-sm text-primary">description</span>
            {attachedFile}
            <button onClick={() => { setAttachedFile(null); setSyllabusText('') }} className="ml-1 hover:text-error transition-colors">
              <span className="material-symbols-outlined text-xs">close</span>
            </button>
          </div>
        )}
        <textarea
          value={syllabusText}
          onChange={(e) => { setSyllabusText(e.target.value); if (attachedFile) setAttachedFile(null) }}
          rows={4}
          placeholder="Paste syllabus text here, or click Attach File to upload a PDF/DOCX/TXT…"
          className="w-full bg-surface-container-low border border-outline-variant/20 focus:border-primary focus:ring-2 focus:ring-primary/20 rounded-lg px-4 py-3 text-sm outline-none resize-none transition-all mb-3"
        />
        {parseError && <p className="text-sm text-error mb-2">{parseError}</p>}
        <button
          onClick={parseSyllabus}
          disabled={parsing || !syllabusText.trim() || !apiKey}
          className="py-2.5 px-6 bg-primary text-on-primary rounded-full text-xs font-label font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {parsing ? 'Parsing syllabus…' : 'Parse Syllabus →'}
        </button>
      </div>

      {/* Summary row */}
      {courses.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center">
            <p className="text-3xl font-serif text-primary">{totalCases}</p>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mt-1">Total Cases</p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center">
            <p className="text-3xl font-serif text-primary">{readCases}</p>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mt-1">Cases Read</p>
          </div>
          <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center">
            <p className="text-3xl font-serif text-primary">★ {hookCases}</p>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mt-1">MSJ / Legal Writing</p>
          </div>
        </div>
      )}

      {/* Course tabs — scrollable single row + inline add */}
      {courses.length > 0 && (
        <>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveTab(c.id)}
                className={`shrink-0 px-4 py-2 rounded-full text-xs font-label font-bold uppercase tracking-wider transition-colors ${
                  activeTab === c.id
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {c.name}
              </button>
            ))}

            {/* Inline add-course input */}
            {addingTab ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = newTabName.trim()
                  if (!name) { setAddingTab(false); return }
                  const newCourse: LocalCourse = {
                    id:         crypto.randomUUID(),
                    name,
                    professor:  null,
                    exam_date:  null,
                    semester:   'Spring 2026',
                    created_at: new Date().toISOString(),
                  }
                  const updated = [...courses, newCourse]
                  setCourses(updated)
                  saveCourses(updated)
                  setActiveTab(newCourse.id)
                  setNewTabName('')
                  setAddingTab(false)
                }}
                className="flex items-center gap-1 shrink-0"
              >
                <input
                  autoFocus
                  value={newTabName}
                  onChange={(e) => setNewTabName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && (setAddingTab(false), setNewTabName(''))}
                  placeholder="Course name…"
                  className="w-36 bg-surface-container-low border border-primary/40 focus:border-primary rounded-full px-3 py-1.5 text-xs outline-none transition-all"
                />
                <button type="submit" className="p-1.5 text-primary hover:bg-primary/10 rounded-full transition-colors">
                  <span className="material-symbols-outlined text-sm">check</span>
                </button>
                <button type="button" onClick={() => { setAddingTab(false); setNewTabName('') }}
                  className="p-1.5 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors">
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </form>
            ) : (
              <button
                onClick={() => setAddingTab(true)}
                title="Add course tab"
                className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-full text-xs font-label font-bold uppercase tracking-wider
                  border border-dashed border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high hover:border-primary/40 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                Add
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {(['all', 'unread', 'in_progress', 'read'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  filterStatus === s
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s]}
              </button>
            ))}
            <button
              onClick={() => setFilterHook((p) => !p)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${
                filterHook ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              ★ MSJ Tracker
            </button>
          </div>

          {/* Table */}
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 shadow-[var(--shadow-sm)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Wk</th>
                  <th className="text-left px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Case</th>
                  <th className="text-left px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Doctrine</th>
                  <th className="text-left px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Status</th>
                  <th className="text-left px-4 py-3 font-label text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Hook</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container/40'}>
                    <td className="px-4 py-3 text-on-surface-variant font-mono text-xs">{c.week_number ?? '—'}</td>
                    <td className="px-4 py-3 font-medium italic text-on-surface">{c.case_name}</td>
                    <td className="px-4 py-3">
                      {c.doctrine_area && (
                        <span className="text-[10px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                          {c.doctrine_area}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleStatus.mutate({ id: c.id, status: c.status as CaseStatus })}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${STATUS_STYLE[c.status as CaseStatus]}`}
                      >
                        {STATUS_LABEL[c.status as CaseStatus]}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-primary text-center">{c.is_professor_hook ? '★' : ''}</td>
                  </tr>
                ))}
                {cases.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-on-surface-variant text-sm">
                      No cases found. Import a syllabus above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {courses.length === 0 && !syllabusText && (
        <div className="flex flex-col items-center gap-4 py-20 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl text-outline-variant">menu_book</span>
          <p className="font-serif text-xl">No courses yet</p>
          <p className="text-sm text-center max-w-sm">Paste your syllabus above and the AI will map your entire semester — every case, every week, every exam date.</p>
        </div>
      )}
    </div>
  )
}
