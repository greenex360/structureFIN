'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchActivityInstances } from '@/lib/finActivities'
import { formatDate, daysUntil, getStatusColor, getStatusLabel } from '@/lib/utils'
import { currentFYStartYear, fyStartYearForDate } from '@/lib/dueDateEngine'
import { UMBRELLA_CATEGORIES, umbrellaForGroup } from '@/lib/categories'
import InstantUpdateModal from '@/components/InstantUpdateModal'
import AnnualComplianceCalendar from '@/components/AnnualComplianceCalendar'

export default function DashboardPage() {
  const router = useRouter()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<any>(null)
  const [upcomingWindow, setUpcomingWindow] = useState(7)
  const [fyFilter, setFyFilter] = useState(currentFYStartYear())

  const fyOptions = useMemo(() => {
    const cur = currentFYStartYear()
    return [cur - 1, cur, cur + 1]
  }, [])

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('users').select('id, name').eq('email', user.email).single()
    if (data) { setCurrentUserId(data.id); setUserName(data.name) }
    load()
  }

  async function load() {
    setLoading(true)
    const { data } = await fetchActivityInstances()
    setRows(data)
    setLoading(false)
  }

  const scopedRows = useMemo(
    () => rows.filter(r => fyStartYearForDate(r.due_date) === fyFilter),
    [rows, fyFilter]
  )
  const active = useMemo(() => scopedRows.filter(r => r.status !== 'completed'), [scopedRows])
  const overdue = useMemo(() => active.filter(r => daysUntil(r.due_date) < 0), [active])
  const dueToday = useMemo(() => active.filter(r => daysUntil(r.due_date) === 0), [active])
  const upcoming = useMemo(
    () => active.filter(r => { const d = daysUntil(r.due_date); return d > 0 && d <= upcomingWindow }),
    [active, upcomingWindow]
  )
  const myTasks = useMemo(
    () => active.filter(r => r.assigned_to === currentUserId).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [active, currentUserId]
  )
  const pendingReview = useMemo(() => scopedRows.filter(r => r.status === 'pending_review'), [scopedRows])
  const needsAttention = useMemo(
    () => [...overdue, ...dueToday].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [overdue, dueToday]
  )

  const groupBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>()
    for (const r of scopedRows) {
      const g = map.get(r.main_group) ?? { total: 0, done: 0 }
      g.total++
      if (r.status === 'completed') g.done++
      map.set(r.main_group, g)
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)
  }, [scopedRows])

  const umbrellaBreakdown = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>()
    for (const r of scopedRows) {
      const u = umbrellaForGroup(r.main_group)
      const key = u?.key ?? 'documents-admin'
      const g = map.get(key) ?? { total: 0, done: 0 }
      g.total++
      if (r.status === 'completed') g.done++
      map.set(key, g)
    }
    return UMBRELLA_CATEGORIES.map(u => ({ ...u, ...(map.get(u.key) ?? { total: 0, done: 0 }) }))
  }, [scopedRows])

  const overallTotal = scopedRows.length
  const overallDone = scopedRows.filter(r => r.status === 'completed').length
  const overallPct = overallTotal ? Math.round((overallDone / overallTotal) * 100) : 0

  const donutSegments = useMemo(() => {
    const withData = umbrellaBreakdown.filter(u => u.total > 0)
    const total = withData.reduce((s, u) => s + u.total, 0)
    const r = 40, circumference = 2 * Math.PI * r
    let offset = 0
    return withData.map(u => {
      const length = total ? (u.total / total) * circumference : 0
      const seg = { ...u, r, circumference, dash: length, offset }
      offset += length
      return seg
    })
  }, [umbrellaBreakdown])

  function goToUmbrella(u: typeof UMBRELLA_CATEGORIES[number]) {
    router.push(`/activities?groups=${encodeURIComponent(u.groups.join(','))}&umbrella=${encodeURIComponent(u.label)}`)
  }

  function Tile({ label, count, icon, color, bg, onClick }: { label: string; count: number; icon: string; color: string; bg: string; onClick?: () => void }) {
    return (
      <button onClick={onClick} className="bg-white border border-[#D7DCD1] rounded-xl p-4 text-left hover:shadow-md transition-shadow flex items-center gap-4">
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0" style={{ background: bg }}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold" style={{ color }}>{count}</div>
          <div className="text-xs text-[#5B665D]">{label}</div>
        </div>
      </button>
    )
  }

  function severity(row: any) {
    const d = daysUntil(row.due_date)
    if (row.status === 'completed') return { color: '#3F9142', text: getStatusLabel(row.status) }
    if (d < 0) return { color: '#B3472F', text: `${Math.abs(d)}d overdue` }
    if (d === 0) return { color: '#B4801F', text: 'Due today' }
    if (d <= 3) return { color: '#B4801F', text: `${d}d left` }
    return { color: '#1B8FA8', text: `${d}d left` }
  }

  function ActivityRow({ row, showDot = false }: { row: any; showDot?: boolean }) {
    const sev = severity(row)
    return (
      <button onClick={() => setSelected(row)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#EFF1EA] text-left">
        {showDot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sev.color }} />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#1C2320] truncate">{row.activity_name}</div>
          <div className="text-xs text-[#8A9389]">{row.main_group} · {row.company?.name ?? 'No company'} · {formatDate(row.due_date)}</div>
        </div>
        <span className="shrink-0 text-xs font-semibold" style={{ color: sev.color }}>{sev.text}</span>
      </button>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-[#D7DCD1] pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#5B665D]">Financial Year</span>
          <select value={fyFilter} onChange={e => setFyFilter(Number(e.target.value))}
            className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-sm bg-white font-medium text-[#1C2320]">
            {fyOptions.map(y => <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>)}
          </select>
        </div>
        <span className="text-xs text-[#8A9389]">{scopedRows.length} activities in this FY</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1C2320]">Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {userName.split(' ')[0] || ''}</h1>
          <p className="text-sm text-[#5B665D] mt-1">Here's what's happening across finance activities</p>
        </div>
        <button onClick={() => router.push('/activities')} className="px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
          + Add Activity
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Overdue" count={overdue.length} icon="⚠️" color="#B3472F" bg="#F3E1DB" onClick={() => router.push('/activities')} />
        <Tile label="Due Today" count={dueToday.length} icon="📅" color="#B4801F" bg="#F2E7D2" onClick={() => router.push('/activities')} />
        <Tile label={`Upcoming (${upcomingWindow}d)`} count={upcoming.length} icon="🗓️" color="#1B8FA8" bg="#DCEFF3" />
        <Tile label="My Tasks" count={myTasks.length} icon="✍️" color="#2E6F5C" bg="#DEEAE4" onClick={() => router.push('/activities?scope=mine')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Compliance Overview donut */}
        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#1C2320] text-sm">Compliance Overview</h2>
            <button onClick={() => router.push('/activities')} className="text-xs text-[#2E6F5C] underline">View Full Report</button>
          </div>
          {overallTotal === 0 ? (
            <p className="text-sm text-[#8A9389] py-6 text-center">No activities in this FY yet.</p>
          ) : (
            <>
              <div className="relative w-40 h-40 mx-auto mb-4">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#EFF1EA" strokeWidth="14" />
                  {donutSegments.map(seg => (
                    <circle
                      key={seg.key}
                      cx="50" cy="50" r={seg.r}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="14"
                      strokeDasharray={`${seg.dash} ${seg.circumference - seg.dash}`}
                      strokeDashoffset={-seg.offset}
                      strokeLinecap="butt"
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-[#1C2320]">{overallPct}%</span>
                  <span className="text-[10px] text-[#8A9389]">Overall</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {umbrellaBreakdown.filter(u => u.total > 0).map(u => (
                  <button key={u.key} onClick={() => goToUmbrella(u)}
                    className="w-full flex items-center justify-between text-xs px-1.5 py-1 rounded hover:bg-[#EFF1EA]">
                    <span className="flex items-center gap-2 text-[#1C2320]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: u.color }} />
                      {u.label}
                    </span>
                    <span className="font-mono text-[#5B665D]">{u.total ? Math.round((u.done / u.total) * 100) : 0}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Top Due & Overdue */}
        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-[#1C2320] text-sm">Top Due &amp; Overdue</h2>
            <button onClick={() => router.push('/activities')} className="text-xs text-[#2E6F5C] underline">View All</button>
          </div>
          <div className="space-y-0.5">
            {loading ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Loading...</p>
            ) : needsAttention.length === 0 ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Nothing overdue or due today. 🎉</p>
            ) : needsAttention.slice(0, 8).map(row => <ActivityRow key={row.id} row={row} showDot />)}
          </div>
        </div>
      </div>

      {/* Category tiles */}
      <div>
        <h2 className="font-semibold text-[#1C2320] text-sm mb-3">Browse by Category</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {umbrellaBreakdown.map(u => (
            <button key={u.key} onClick={() => goToUmbrella(u)}
              className="bg-white border border-[#D7DCD1] rounded-xl p-4 text-left hover:shadow-md hover:-translate-y-0.5 transition-all">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-3" style={{ background: `${u.color}1A`, color: u.color }}>
                {u.icon}
              </div>
              <div className="font-medium text-sm text-[#1C2320]">{u.label}</div>
              <div className="text-xs text-[#8A9389] mt-0.5">{u.description}</div>
              {u.total > 0 && (
                <div className="text-xs font-medium mt-2" style={{ color: u.color }}>{u.total - u.done} open · {u.total} total</div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-[#1C2320] text-sm">My Tasks</h2>
            <span className="text-xs text-[#8A9389]">{myTasks.length}</span>
          </div>
          <div className="space-y-0.5">
            {loading ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Loading...</p>
            ) : myTasks.length === 0 ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Nothing assigned to you right now.</p>
            ) : myTasks.slice(0, 8).map(row => <ActivityRow key={row.id} row={row} />)}
          </div>
        </div>

        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-[#1C2320] text-sm">Upcoming Activities</h2>
            <div className="flex gap-1">
              {[7, 15, 30].map(w => (
                <button key={w} onClick={() => setUpcomingWindow(w)}
                  className={`px-2 py-1 rounded text-xs ${upcomingWindow === w ? 'bg-[#2E6F5C] text-white' : 'text-[#8A9389] hover:bg-[#EFF1EA]'}`}>
                  {w}d
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-0.5">
            {upcoming.length === 0 ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Nothing in the next {upcomingWindow} days.</p>
            ) : upcoming.slice(0, 8).map(row => <ActivityRow key={row.id} row={row} />)}
          </div>
        </div>

        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-[#1C2320] text-sm">Pending Review</h2>
            <span className="text-xs text-[#8A9389]">{pendingReview.length}</span>
          </div>
          <div className="space-y-0.5">
            {pendingReview.length === 0 ? (
              <p className="text-sm text-[#8A9389] px-3 py-4">Nothing waiting on review.</p>
            ) : pendingReview.slice(0, 8).map(row => <ActivityRow key={row.id} row={row} />)}
          </div>
        </div>

        <div className="bg-white border border-[#D7DCD1] rounded-xl p-4">
          <h2 className="font-semibold text-[#1C2320] text-sm mb-3">Activity Status by Group</h2>
          {groupBreakdown.length === 0 ? (
            <div className="text-sm text-[#8A9389]">
              No activities yet.{' '}
              <button onClick={() => router.push('/activities')} className="text-[#2E6F5C] underline">
                Add a template to Activity Master, then run Generate Activities
              </button>.
            </div>
          ) : (
            <div className="space-y-2.5">
              {groupBreakdown.map(([group, stat]) => {
                const u = umbrellaForGroup(group)
                return (
                  <div key={group}>
                    <div className="flex justify-between text-xs text-[#5B665D] mb-1">
                      <span>{group}</span>
                      <span className="font-mono">{stat.done} / {stat.total}</span>
                    </div>
                    <div className="h-1.5 bg-[#EFF1EA] rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${stat.total ? (stat.done / stat.total) * 100 : 0}%`, background: u?.color ?? '#2E6F5C' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <AnnualComplianceCalendar rows={scopedRows} fyFilter={fyFilter} onSelect={setSelected} />

      {selected && (
        <InstantUpdateModal instance={selected} onClose={() => setSelected(null)} onSaved={load} />
      )}
    </div>
  )
}
