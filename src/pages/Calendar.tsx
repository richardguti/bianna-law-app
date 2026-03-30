import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, BIANNA_USER_ID, type CaseRow, type AssignmentType } from '../lib/supabase'
import { loadCourses, type LocalCourse } from '../lib/courses'

/* ─── Types ─────────────────────────────────────────────────────────────── */
export type LocalAssignment = {
  id: string
  title: string
  type: AssignmentType
  due_date: string
  start_time?: string   // 'HH:MM' 24-hour — absent means all-day
  end_time?: string     // 'HH:MM' 24-hour
  course_id: string | null
  notes: string | null
  completed?: boolean
}

type View = 'month' | 'week' | 'day'
type EvColor = AssignmentType | 'hook'

type CalEvent = {
  id: string
  title: string
  date: string
  startTime?: string
  endTime?: string
  color: EvColor
  assignmentId?: string
  notes?: string | null
  completed?: boolean
}

/* ─── Constants ─────────────────────────────────────────────────────────── */
const LS_KEY   = 'slp_assignments'
const HOUR_PX  = 60   // px per hour in week/day time grid

const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS_S     = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAYS_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const COLORS: Record<EvColor, { bg: string; border: string; text: string; dot: string }> = {
  final:      { bg: '#FFE5E5', border: '#FF3B30', text: '#C0392B', dot: '#FF3B30' },
  midterm:    { bg: '#FFF0D9', border: '#FF9500', text: '#9C5D00', dot: '#FF9500' },
  quiz:       { bg: '#FFFBDE', border: '#D4AC00', text: '#6B5500', dot: '#D4AC00' },
  assignment: { bg: '#E5F0FF', border: '#007AFF', text: '#0056CC', dot: '#007AFF' },
  hook:       { bg: '#F5EEFF', border: '#AF52DE', text: '#7B2CB0', dot: '#AF52DE' },
  reading:    { bg: '#E5F9EC', border: '#34C759', text: '#1E7A37', dot: '#34C759' },
}

const TYPE_LABELS: Partial<Record<string, string>> = {
  final: 'Final Exam', midterm: 'Midterm', quiz: 'Quiz / Problem Set',
  assignment: 'Assignment', hook: 'Prof. Hook Case', reading: 'Reading',
}

const ATYPES: { value: AssignmentType; label: string }[] = [
  { value: 'final',      label: 'Final Exam'        },
  { value: 'midterm',    label: 'Midterm'            },
  { value: 'quiz',       label: 'Quiz / Problem Set' },
  { value: 'assignment', label: 'Assignment'         },
  { value: 'reading',    label: 'Reading'            },
]

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const LS = {
  load: (): LocalAssignment[] => { try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] } },
  save: (list: LocalAssignment[]) => localStorage.setItem(LS_KEY, JSON.stringify(list)),
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(d.getDate()+n); return r }
function startOfWeek(d: Date): Date { const r = new Date(d); r.setDate(d.getDate()-d.getDay()); return r }
function timeToMin(t: string) { const [h,m]=t.split(':').map(Number); return h*60+m }
function minToTime(m: number) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` }
function fmt12(t: string) {
  const [h,m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2,'0')} ${suffix}`
}
function fmtHour(h: number) { return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM` }

function weekToDate(created: string, week: number) {
  const d = new Date(created)
  const mon = new Date(d); mon.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay()-1))
  mon.setDate(mon.getDate() + (week-1)*7)
  return mon.toISOString().slice(0,10)
}

function buildICS(events: Array<{ title: string; date: string; notes?: string | null }>) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SeniorLawPartner//EN','CALSCALE:GREGORIAN']
  for (const ev of events) {
    const d = ev.date.replace(/-/g,'')
    const next = new Date(new Date(ev.date).getTime()+86_400_000).toISOString().slice(0,10).replace(/-/g,'')
    lines.push('BEGIN:VEVENT',`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${ev.title}`,...(ev.notes?[`DESCRIPTION:${ev.notes}`]:[]),'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
function downloadICS(content: string) {
  const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([content],{type:'text/calendar'})),download:'calendar.ics'})
  a.click()
}

/* ─── Mini Calendar (sidebar) ────────────────────────────────────────────── */
function MiniCal({
  viewDate, selectedDate, todayStr, onSelect, onMonthChange,
}: {
  viewDate: Date; selectedDate: Date; todayStr: string
  onSelect: (d: Date) => void; onMonthChange: (d: Date) => void
}) {
  const yr = viewDate.getFullYear(), mo = viewDate.getMonth()
  const firstDay = new Date(yr, mo, 1).getDay()
  const days = new Date(yr, mo+1, 0).getDate()
  const cells: (number|null)[] = [...Array(firstDay).fill(null), ...Array.from({length:days},(_,i)=>i+1)]
  while (cells.length%7!==0) cells.push(null)

  function prev() { const d=new Date(yr,mo-1,1); onMonthChange(d) }
  function next() { const d=new Date(yr,mo+1,1); onMonthChange(d) }

  const selStr = toYMD(selectedDate)

  return (
    <div className="px-3 py-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <button onClick={prev} className="p-0.5 rounded hover:bg-black/5 text-gray-500">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span className="text-[11px] font-semibold text-gray-700">{MONTHS[mo]} {yr}</span>
        <button onClick={next} className="p-0.5 rounded hover:bg-black/5 text-gray-500">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {['S','M','T','W','T','F','S'].map((d,i) => (
          <div key={i} className="text-[9px] font-semibold text-gray-400 pb-1">{d}</div>
        ))}
        {cells.map((day, i) => {
          const ds = day ? `${yr}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : ''
          const isToday = ds === todayStr
          const isSel = ds === selStr
          return (
            <button key={i} disabled={!day}
              onClick={() => day && onSelect(new Date(yr,mo,day))}
              className={`w-6 h-6 mx-auto my-0.5 rounded-full text-[10px] flex items-center justify-center transition-colors ${
                !day ? '' :
                isToday ? 'bg-[#007AFF] text-white font-semibold' :
                isSel ? 'bg-[#007AFF]/15 text-[#007AFF] font-semibold' :
                'hover:bg-black/5 text-gray-700'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */
function Sidebar({
  viewDate, selectedDate, todayStr, hiddenTypes, onSelect, onMonthChange, onToggleType,
}: {
  viewDate: Date; selectedDate: Date; todayStr: string
  hiddenTypes: Set<EvColor>
  onSelect: (d: Date) => void
  onMonthChange: (d: Date) => void
  onToggleType: (t: EvColor) => void
}) {
  return (
    <aside className="w-52 shrink-0 border-r border-gray-200 bg-[#F5F5F7] flex flex-col overflow-y-auto">
      <MiniCal viewDate={viewDate} selectedDate={selectedDate} todayStr={todayStr}
        onSelect={onSelect} onMonthChange={onMonthChange} />
      <div className="border-t border-gray-200 px-4 py-3">
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">Event Types</p>
        <div className="space-y-1">
          {(Object.entries(COLORS) as [EvColor, typeof COLORS[EvColor]][]).map(([type, c]) => (
            <button key={type} onClick={() => onToggleType(type)}
              className="flex items-center gap-2 w-full text-left rounded px-1 py-0.5 hover:bg-black/5">
              <span className="w-3 h-3 rounded-sm shrink-0 border"
                style={{ background: hiddenTypes.has(type) ? 'transparent' : c.border, borderColor: c.border }} />
              <span className="text-[11px] text-gray-600">{TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

/* ─── Event Pill (month view) ────────────────────────────────────────────── */
function EventPill({ ev, onClick }: { ev: CalEvent; onClick: (e: React.MouseEvent) => void }) {
  const c = COLORS[ev.color] ?? COLORS.assignment
  return (
    <button onClick={onClick}
      className="w-full text-left truncate rounded text-[10px] font-medium px-1.5 py-0.5 leading-tight"
      style={{ background: c.bg, color: c.text, borderLeft: `3px solid ${c.border}` }}
    >
      {ev.startTime && <span className="opacity-70">{fmt12(ev.startTime)} </span>}
      {ev.title}
    </button>
  )
}

/* ─── Month View ─────────────────────────────────────────────────────────── */
function MonthView({
  year, month, events, todayStr, onDayClick, onEventClick, onAddClick,
}: {
  year: number; month: number
  events: CalEvent[]; todayStr: string
  onDayClick: (dateStr: string) => void
  onEventClick: (ev: CalEvent, e: React.MouseEvent) => void
  onAddClick: (dateStr: string) => void
}) {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const prevDays    = new Date(year, month, 0).getDate()
  const cells: { day: number; cur: boolean }[] = []

  for (let i = firstDay-1; i >= 0; i--)
    cells.push({ day: prevDays-i, cur: false })
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, cur: true })
  while (cells.length % 7 !== 0)
    cells.push({ day: cells.length - firstDay - daysInMonth + 1, cur: false })

  function eventsForDay(dateStr: string) {
    return events.filter(e => e.date === dateStr)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAYS_S.map(d => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold text-gray-500">{d}</div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-7 flex-1 overflow-y-auto" style={{ gridTemplateRows: `repeat(${cells.length/7}, minmax(0, 1fr))` }}>
        {cells.map((cell, i) => {
          const dateStr = cell.cur
            ? `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`
            : ''
          const isToday = dateStr === todayStr
          const dayEvs  = dateStr ? eventsForDay(dateStr) : []

          return (
            <div key={i}
              onClick={() => cell.cur && onDayClick(dateStr)}
              className={`border-b border-r border-gray-200 p-1 min-h-[90px] group relative ${
                cell.cur ? 'cursor-pointer hover:bg-gray-50' : 'bg-[#FAFAFA]'
              }`}
            >
              {/* Date number */}
              <div className="flex items-start justify-between mb-0.5">
                <span className={`text-xs font-semibold inline-flex items-center justify-center w-6 h-6 rounded-full ${
                  isToday ? 'bg-[#007AFF] text-white' :
                  cell.cur ? 'text-gray-800' : 'text-gray-400'
                }`}>{cell.day}</span>
                {/* Add button on hover */}
                {cell.cur && (
                  <button onClick={(e) => { e.stopPropagation(); onAddClick(dateStr) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200 text-gray-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                )}
              </div>
              {/* Events */}
              <div className="space-y-0.5">
                {dayEvs.slice(0, 4).map((ev, j) => (
                  <EventPill key={j} ev={ev} onClick={(e) => { e.stopPropagation(); onEventClick(ev, e) }} />
                ))}
                {dayEvs.length > 4 && (
                  <div className="text-[10px] text-gray-400 pl-1">{dayEvs.length-4} more…</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Time Grid (shared by Week + Day) ───────────────────────────────────── */
function TimeGrid({
  days, events, todayStr, onSlotClick, onEventClick,
}: {
  days: Date[]
  events: CalEvent[]
  todayStr: string
  onSlotClick: (dateStr: string, time: string) => void
  onEventClick: (ev: CalEvent, e: React.MouseEvent) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = new Date()
  const nowMin = now.getHours()*60 + now.getMinutes()

  // Scroll to 8 AM on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_PX - 20
    }
  }, [])

  // Compute non-overlapping columns for events on a single day
  function layoutEvents(dayEvs: CalEvent[]) {
    const timed = dayEvs.filter(e => e.startTime)
    // Sort by start
    const sorted = [...timed].sort((a, b) => timeToMin(a.startTime!) - timeToMin(b.startTime!))
    // Assign columns greedily
    const cols: CalEvent[][] = []
    const assigned = new Map<string, { col: number; total: number }>()
    for (const ev of sorted) {
      const start = timeToMin(ev.startTime!)
      const end   = ev.endTime ? timeToMin(ev.endTime) : start + 60
      let placed = false
      for (let c = 0; c < cols.length; c++) {
        const last = cols[c][cols[c].length-1]
        const lastEnd = last.endTime ? timeToMin(last.endTime!) : timeToMin(last.startTime!) + 60
        if (start >= lastEnd) {
          cols[c].push(ev)
          assigned.set(ev.id, { col: c, total: 0 })
          placed = true; break
        }
      }
      if (!placed) {
        assigned.set(ev.id, { col: cols.length, total: 0 })
        cols.push([ev])
      }
    }
    // Set total columns for each event group (simplified: all in same "cluster" share total)
    for (const ev of sorted) {
      const a = assigned.get(ev.id)!
      const start = timeToMin(ev.startTime!)
      const end   = ev.endTime ? timeToMin(ev.endTime) : start + 60
      // Count how many columns overlap this event's time
      let maxCol = a.col
      for (const [id2, a2] of assigned) {
        const ev2 = sorted.find(e => e.id === id2)!
        const s2 = timeToMin(ev2.startTime!)
        const e2 = ev2.endTime ? timeToMin(ev2.endTime!) : s2 + 60
        if (s2 < end && e2 > start) maxCol = Math.max(maxCol, a2.col)
      }
      assigned.set(ev.id, { col: a.col, total: maxCol + 1 })
    }
    return { timed: sorted, assigned }
  }

  function handleGridClick(dateStr: string, e: React.MouseEvent<HTMLDivElement>) {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const min = Math.round((y / HOUR_PX) * 60)
    onSlotClick(dateStr, minToTime(min))
  }

  const totalHeight = HOUR_COUNT * HOUR_PX

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* All-day row */}
      <div className="flex border-b border-gray-200 bg-white shrink-0">
        <div className="w-14 shrink-0 border-r border-gray-200 py-1 text-[9px] text-gray-400 text-right pr-2 self-end">all-day</div>
        {days.map((day, di) => {
          const ds = toYMD(day)
          const allDay = events.filter(e => e.date === ds && !e.startTime)
          return (
            <div key={di} className={`flex-1 border-r border-gray-200 min-h-[28px] p-0.5 ${di === days.length-1 ? 'border-r-0' : ''}`}>
              {allDay.map((ev, j) => (
                <EventPill key={j} ev={ev} onClick={(e) => onEventClick(ev, e)} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
        {/* Time labels */}
        <div className="w-14 shrink-0 border-r border-gray-200 relative" style={{ height: totalHeight }}>
          {Array.from({ length: HOUR_COUNT }, (_, h) => (
            <div key={h} className="absolute w-full text-right pr-2"
              style={{ top: h * HOUR_PX - 7, height: HOUR_PX }}>
              {h > 0 && (
                <span className="text-[9px] font-medium text-gray-400">{fmtHour(h)}</span>
              )}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="flex flex-1 relative">
          {days.map((day, di) => {
            const ds = toYMD(day)
            const isToday = ds === todayStr
            const dayEvs  = events.filter(e => e.date === ds)
            const { timed, assigned } = layoutEvents(dayEvs)
            const showNowLine = isToday

            return (
              <div key={di}
                className={`flex-1 relative border-r border-gray-200 ${di === days.length-1 ? 'border-r-0' : ''}`}
                style={{ height: totalHeight }}
                onClick={(e) => handleGridClick(ds, e)}
              >
                {/* Hour lines */}
                {Array.from({ length: HOUR_COUNT }, (_, h) => (
                  <div key={h} className="absolute w-full border-t border-gray-100"
                    style={{ top: h * HOUR_PX }} />
                ))}
                {/* Half-hour lines */}
                {Array.from({ length: HOUR_COUNT }, (_, h) => (
                  <div key={h} className="absolute w-full border-t border-gray-50"
                    style={{ top: h * HOUR_PX + HOUR_PX/2 }} />
                ))}

                {/* Current time line */}
                {showNowLine && (
                  <div className="absolute w-full z-20 flex items-center pointer-events-none"
                    style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <div className="w-2 h-2 rounded-full bg-[#FF3B30] -ml-1 shrink-0" />
                    <div className="flex-1 h-px bg-[#FF3B30]" />
                  </div>
                )}

                {/* Timed events */}
                {timed.map((ev) => {
                  const a    = assigned.get(ev.id)!
                  const top  = (timeToMin(ev.startTime!) / 60) * HOUR_PX
                  const dur  = ev.endTime
                    ? timeToMin(ev.endTime) - timeToMin(ev.startTime!)
                    : 60
                  const h    = Math.max((dur / 60) * HOUR_PX, 20)
                  const w    = 100 / a.total
                  const l    = a.col * w
                  const c    = COLORS[ev.color] ?? COLORS.assignment
                  return (
                    <button key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev, e) }}
                      className="absolute text-left rounded overflow-hidden px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-90 z-10"
                      style={{
                        top, height: h,
                        left: `${l}%`, width: `calc(${w}% - 2px)`,
                        background: c.bg, color: c.text,
                        borderLeft: `3px solid ${c.border}`,
                      }}
                    >
                      <div className="font-semibold truncate leading-tight">{ev.title}</div>
                      {h > 28 && ev.startTime && (
                        <div className="opacity-70 leading-tight">{fmt12(ev.startTime)}{ev.endTime ? ` – ${fmt12(ev.endTime)}` : ''}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── Week View ──────────────────────────────────────────────────────────── */
function WeekView({ weekStart, events, todayStr, onSlotClick, onEventClick }: {
  weekStart: Date; events: CalEvent[]; todayStr: string
  onSlotClick: (d: string, t: string) => void
  onEventClick: (ev: CalEvent, e: React.MouseEvent) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="flex border-b border-gray-200 bg-white shrink-0">
        <div className="w-14 shrink-0 border-r border-gray-200" />
        {days.map((day, i) => {
          const ds = toYMD(day)
          const isToday = ds === todayStr
          return (
            <div key={i} className={`flex-1 text-center py-2 border-r border-gray-200 ${i===6?'border-r-0':''}`}>
              <div className="text-[10px] font-medium text-gray-500 uppercase">{DAYS_S[day.getDay()]}</div>
              <div className={`text-xl font-semibold mx-auto w-9 h-9 flex items-center justify-center rounded-full ${
                isToday ? 'bg-[#007AFF] text-white' : 'text-gray-800'
              }`}>{day.getDate()}</div>
            </div>
          )
        })}
      </div>
      <TimeGrid days={days} events={events} todayStr={todayStr}
        onSlotClick={onSlotClick} onEventClick={onEventClick} />
    </div>
  )
}

/* ─── Day View ───────────────────────────────────────────────────────────── */
function DayView({ date, events, todayStr, onSlotClick, onEventClick }: {
  date: Date; events: CalEvent[]; todayStr: string
  onSlotClick: (d: string, t: string) => void
  onEventClick: (ev: CalEvent, e: React.MouseEvent) => void
}) {
  const isToday = toYMD(date) === todayStr
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-gray-200 bg-white shrink-0">
        <div className="w-14 shrink-0 border-r border-gray-200" />
        <div className="flex-1 text-center py-2">
          <div className="text-[10px] font-medium text-gray-500 uppercase">{DAYS_FULL[date.getDay()]}</div>
          <div className={`text-3xl font-semibold mx-auto w-12 h-12 flex items-center justify-center rounded-full ${
            isToday ? 'bg-[#007AFF] text-white' : 'text-gray-800'
          }`}>{date.getDate()}</div>
        </div>
      </div>
      <TimeGrid days={[date]} events={events} todayStr={todayStr}
        onSlotClick={onSlotClick} onEventClick={onEventClick} />
    </div>
  )
}

/* ─── Event Detail Panel ─────────────────────────────────────────────────── */
function EventDetail({
  ev, assignment, x, y, onEdit, onDelete, onClose,
}: {
  ev: CalEvent; assignment?: LocalAssignment
  x: number; y: number
  onEdit: () => void; onDelete: () => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const c   = COLORS[ev.color] ?? COLORS.assignment

  // Adjust position to stay on screen
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    if (rect.right > vw - 8)  el.style.left = `${vw - rect.width - 8}px`
    if (rect.bottom > vh - 8) el.style.top  = `${vh - rect.height - 8}px`
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const dateLabel = new Date(ev.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})

  return (
    <div ref={ref} className="fixed z-[200] bg-white rounded-xl shadow-2xl border border-gray-200 w-72"
      style={{ left: x, top: y }}>
      <div className="h-1.5 rounded-t-xl" style={{ background: c.border }} />
      <div className="p-4">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-gray-900 text-base leading-tight flex-1 mr-2">{ev.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0 mt-0.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="text-[11px] text-gray-500 space-y-0.5">
          <div>{dateLabel}</div>
          {ev.startTime && (
            <div>{fmt12(ev.startTime)}{ev.endTime ? ` – ${fmt12(ev.endTime)}` : ''}</div>
          )}
          <div style={{ color: c.border }} className="font-medium">{TYPE_LABELS[ev.color] ?? ev.color}</div>
          {ev.notes && <div className="text-gray-400 italic">{ev.notes}</div>}
        </div>
        {assignment && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
            <button onClick={onEdit}
              className="flex-1 text-[11px] font-semibold text-[#007AFF] border border-[#007AFF]/30 rounded-lg py-1.5 hover:bg-[#007AFF]/5">
              Edit Event
            </button>
            <button onClick={onDelete}
              className="flex-1 text-[11px] font-semibold text-[#FF3B30] border border-[#FF3B30]/30 rounded-lg py-1.5 hover:bg-[#FF3B30]/5">
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Add / Edit Modal ───────────────────────────────────────────────────── */
function EventModal({
  initial, courses, onSave, onClose,
}: {
  initial?: Partial<LocalAssignment>
  courses: LocalCourse[]
  onSave: (a: LocalAssignment) => void
  onClose: () => void
}) {
  const isNew = !initial?.id
  const [title,     setTitle]     = useState(initial?.title ?? '')
  const [type,      setType]      = useState<AssignmentType>(initial?.type ?? 'assignment')
  const [courseId,  setCourseId]  = useState(initial?.course_id ?? '')
  const [dueDate,   setDueDate]   = useState(initial?.due_date ?? '')
  const [allDay,    setAllDay]    = useState(!initial?.start_time)
  const [startTime, setStartTime] = useState(initial?.start_time ?? '09:00')
  const [endTime,   setEndTime]   = useState(initial?.end_time   ?? '10:00')
  const [notes,     setNotes]     = useState(initial?.notes ?? '')

  function save(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      id:         initial?.id ?? crypto.randomUUID(),
      title,
      type,
      due_date:   dueDate,
      start_time: allDay ? undefined : startTime,
      end_time:   allDay ? undefined : endTime,
      course_id:  courseId || null,
      notes:      notes || null,
      completed:  initial?.completed,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200">
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{isNew ? 'New Event' : 'Edit Event'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          {/* Title */}
          <input autoFocus required value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Event title"
            className="w-full text-base font-medium border-b border-gray-200 pb-2 outline-none focus:border-[#007AFF] placeholder:text-gray-300"
          />

          {/* Type selector */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {ATYPES.map(t => {
                const c = COLORS[t.value as EvColor]
                return (
                  <button key={t.value} type="button" onClick={() => setType(t.value)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all"
                    style={type === t.value
                      ? { background: c.border, color: '#fff', borderColor: c.border }
                      : { background: 'transparent', color: c.text, borderColor: c.border+'66' }
                    }>{t.label}</button>
                )
              })}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Date</label>
            <input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 w-full"
            />
          </div>

          {/* All-day toggle + times */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">All-day</label>
              <button type="button" onClick={() => setAllDay(v => !v)}
                className={`w-9 h-5 rounded-full transition-colors relative ${allDay ? 'bg-[#34C759]' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${allDay ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {!allDay && (
              <div className="flex gap-2 items-center">
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-[#007AFF]" />
                <span className="text-gray-400 text-sm">–</span>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-[#007AFF]" />
              </div>
            )}
          </div>

          {/* Course */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Course</label>
            <select value={courseId} onChange={e => setCourseId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#007AFF] bg-white">
              <option value="">— None —</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Coverage, location, % of grade…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#007AFF]" />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: '#007AFF' }}>
              {isNew ? 'Add Event' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Main Calendar Component ────────────────────────────────────────────── */
export function Calendar() {
  const today       = new Date()
  const todayStr    = toYMD(today)

  const [view,         setView]         = useState<View>('month')
  const [selectedDate, setSelectedDate] = useState<Date>(today)
  const [miniDate,     setMiniDate]     = useState<Date>(today)   // controls mini-cal month
  const [assignments,  setAssignments]  = useState<LocalAssignment[]>(LS.load)
  const [hiddenTypes,  setHiddenTypes]  = useState<Set<EvColor>>(new Set())

  // Modal state
  const [showModal,    setShowModal]    = useState(false)
  const [modalInit,    setModalInit]    = useState<Partial<LocalAssignment>>({})
  const [detailEv,     setDetailEv]     = useState<{ ev: CalEvent; x: number; y: number } | null>(null)
  const [editTarget,   setEditTarget]   = useState<LocalAssignment | null>(null)

  // Data
  const [courses] = useState<LocalCourse[]>(loadCourses)
  const { data: cases = [] } = useQuery<CaseRow[]>({
    queryKey: ['cases-calendar'],
    queryFn: async () => {
      const { data } = await supabase.from('cases').select('*').eq('user_id', BIANNA_USER_ID)
      return (data ?? []) as CaseRow[]
    },
  })

  /* ── Build unified event list ─────────────────────────────────────────── */
  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = []

    for (const a of assignments) {
      if (a.completed) continue
      list.push({
        id: a.id, title: a.title, date: a.due_date,
        startTime: a.start_time, endTime: a.end_time,
        color: a.type as EvColor, assignmentId: a.id,
        notes: a.notes, completed: a.completed,
      })
    }
    for (const c of courses) {
      if (c.exam_date) {
        const already = assignments.some(a => a.course_id === c.id && a.type === 'final')
        if (!already)
          list.push({ id: `final-${c.id}`, title: `${c.name} — Final`, date: c.exam_date, color: 'final' })
      }
    }
    for (const cas of cases) {
      if (cas.week_number == null) continue
      const course = courses.find(c => c.id === cas.course_id)
      if (!course) continue
      list.push({
        id: `cas-${cas.id}`, title: cas.case_name,
        date: weekToDate(course.created_at, cas.week_number),
        color: cas.is_professor_hook ? 'hook' : 'reading',
      })
    }
    return list.filter(e => !hiddenTypes.has(e.color))
  }, [assignments, courses, cases, hiddenTypes])

  /* ── CRUD ────────────────────────────────────────────────────────────── */
  const upsert = useCallback((a: LocalAssignment) => {
    setAssignments(prev => {
      const next = prev.find(x => x.id === a.id)
        ? prev.map(x => x.id === a.id ? a : x)
        : [...prev, a]
      const sorted = next.sort((x, y) => x.due_date.localeCompare(y.due_date))
      LS.save(sorted)
      return sorted
    })
  }, [])

  const remove = useCallback((id: string) => {
    setAssignments(prev => { const next = prev.filter(a => a.id !== id); LS.save(next); return next })
  }, [])

  /* ── Navigation ──────────────────────────────────────────────────────── */
  function prev() {
    setSelectedDate(d => {
      if (view === 'month') return new Date(d.getFullYear(), d.getMonth()-1, 1)
      if (view === 'week')  return addDays(d, -7)
      return addDays(d, -1)
    })
  }
  function next() {
    setSelectedDate(d => {
      if (view === 'month') return new Date(d.getFullYear(), d.getMonth()+1, 1)
      if (view === 'week')  return addDays(d, 7)
      return addDays(d, 1)
    })
  }
  function goToday() { setSelectedDate(today); setMiniDate(today) }

  // Keep mini-cal in sync with main view
  useEffect(() => { setMiniDate(selectedDate) }, [selectedDate])

  /* ── Title text ──────────────────────────────────────────────────────── */
  const title = useMemo(() => {
    if (view === 'month')
      return `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
    if (view === 'week') {
      const ws = startOfWeek(selectedDate)
      const we = addDays(ws, 6)
      if (ws.getMonth() === we.getMonth())
        return `${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`
      return `${MONTHS[ws.getMonth()]} – ${MONTHS[we.getMonth()]} ${we.getFullYear()}`
    }
    return selectedDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})
  }, [view, selectedDate])

  /* ── ICS export ──────────────────────────────────────────────────────── */
  function exportICS() {
    downloadICS(buildICS(assignments.filter(a=>!a.completed).map(a=>({title:a.title,date:a.due_date,notes:a.notes}))))
  }

  /* ── Event handlers ──────────────────────────────────────────────────── */
  function handleDayClick(ds: string) {
    setSelectedDate(new Date(ds+'T12:00:00'))
    setView('day')
  }
  function handleSlotClick(ds: string, time: string) {
    setModalInit({ due_date: ds, start_time: time, end_time: minToTime(timeToMin(time)+60) })
    setShowModal(true)
  }
  function handleAddClick(ds: string) {
    setModalInit({ due_date: ds })
    setShowModal(true)
  }
  function handleEventClick(ev: CalEvent, e: React.MouseEvent) {
    setDetailEv({ ev, x: e.clientX, y: e.clientY })
  }
  function handleDetailEdit() {
    if (!detailEv) return
    const a = assignments.find(x => x.id === detailEv.ev.assignmentId)
    if (a) { setEditTarget(a); setDetailEv(null) }
  }
  function handleDetailDelete() {
    if (!detailEv?.ev.assignmentId) return
    remove(detailEv.ev.assignmentId)
    setDetailEv(null)
  }

  return (
    <div className="flex h-full overflow-hidden bg-white" style={{fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'}}>

      {/* Sidebar */}
      <Sidebar
        viewDate={miniDate} selectedDate={selectedDate} todayStr={todayStr}
        hiddenTypes={hiddenTypes}
        onSelect={d => { setSelectedDate(d); setMiniDate(d) }}
        onMonthChange={d => setMiniDate(d)}
        onToggleType={t => setHiddenTypes(prev => {
          const s = new Set(prev)
          s.has(t) ? s.delete(t) : s.add(t)
          return s
        })}
      />

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 bg-white shrink-0">
          {/* Nav */}
          <div className="flex items-center gap-1">
            <button onClick={prev}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button onClick={next}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-500">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          <button onClick={goToday}
            className="text-xs font-semibold text-gray-700 border border-gray-300 rounded-md px-2.5 py-1 hover:bg-gray-50">
            Today
          </button>

          {/* Title */}
          <h1 className="flex-1 text-base font-semibold text-gray-900 text-center">{title}</h1>

          {/* Export ICS */}
          <button onClick={exportICS}
            className="text-[11px] font-medium text-gray-500 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export .ics
          </button>

          {/* Add */}
          <button onClick={() => { setModalInit({}); setShowModal(true) }}
            className="text-[11px] font-semibold text-white rounded-md px-3 py-1.5 flex items-center gap-1"
            style={{ background: '#007AFF' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14"/></svg>
            Add Event
          </button>

          {/* View toggle */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-[11px] font-semibold">
            {(['day','week','month'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors capitalize ${
                  view === v ? 'bg-[#007AFF] text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}>{v}</button>
            ))}
          </div>
        </div>

        {/* Calendar body */}
        {view === 'month' && (
          <MonthView
            year={selectedDate.getFullYear()} month={selectedDate.getMonth()}
            events={events} todayStr={todayStr}
            onDayClick={handleDayClick}
            onEventClick={handleEventClick}
            onAddClick={handleAddClick}
          />
        )}
        {view === 'week' && (
          <WeekView
            weekStart={startOfWeek(selectedDate)}
            events={events} todayStr={todayStr}
            onSlotClick={handleSlotClick}
            onEventClick={handleEventClick}
          />
        )}
        {view === 'day' && (
          <DayView
            date={selectedDate}
            events={events} todayStr={todayStr}
            onSlotClick={handleSlotClick}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {/* Event detail popover */}
      {detailEv && (
        <EventDetail
          ev={detailEv.ev}
          assignment={assignments.find(a => a.id === detailEv.ev.assignmentId)}
          x={detailEv.x + 8} y={detailEv.y + 8}
          onEdit={handleDetailEdit}
          onDelete={handleDetailDelete}
          onClose={() => setDetailEv(null)}
        />
      )}

      {/* Add/Edit modal */}
      {(showModal || editTarget) && (
        <EventModal
          initial={editTarget ?? modalInit}
          courses={courses}
          onSave={upsert}
          onClose={() => { setShowModal(false); setEditTarget(null); setModalInit({}) }}
        />
      )}
    </div>
  )
}
