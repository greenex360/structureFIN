'use client'

import { useEffect, useMemo, useState } from 'react'
import { fyMonths } from '@/lib/dueDateEngine'
import { daysUntil, formatDate, getStatusLabel } from '@/lib/utils'
import { MAIN_GROUPS, fetchCompanies } from '@/lib/finActivities'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dotColor(row: any) {
  if (row.status === 'completed') return '#3F9142'
  if (daysUntil(row.due_date) < 0) return '#B3472F'
  if (row.status === 'in_progress') return '#B4801F'
  return '#8AA0B8'
}

function statusText(row: any) {
  if (row.status === 'completed') return { label: 'Completed', color: '#3F9142' }
  if (daysUntil(row.due_date) < 0) return { label: 'Overdue', color: '#B3472F' }
  if (row.status === 'in_progress') return { label: 'In Progress', color: '#B4801F' }
  return { label: getStatusLabel(row.status), color: '#5B665D' }
}

export default function AnnualComplianceCalendar({
  rows, fyFilter, onSelect,
}: {
  rows: any[]
  fyFilter: number
  onSelect: (row: any) => void
}) {
  const months = useMemo(() => fyMonths(fyFilter), [fyFilter])

  const defaultMonthIdx = useMemo(() => {
    const now = new Date()
    const idx = months.findIndex(mm => mm.y === now.getFullYear() && mm.m === now.getMonth() + 1)
    return idx >= 0 ? idx : 0
  }, [months])

  const [monthIdx, setMonthIdx] = useState(defaultMonthIdx)
  const [companyId, setCompanyId] = useState('')
  const [companies, setCompanies] = useState<any[]>([])

  useEffect(() => { fetchCompanies().then(setCompanies) }, [])
  useEffect(() => { setMonthIdx(defaultMonthIdx) }, [defaultMonthIdx])

  const companyRows = useMemo(
    () => companyId ? rows.filter(r => r.company_id === companyId) : rows,
    [rows, companyId]
  )

  const selectedMonth = months[monthIdx]
  const monthRows = useMemo(() => {
    if (!selectedMonth) return []
    return companyRows.filter(r => {
      const d = new Date(r.due_date)
      return d.getFullYear() === selectedMonth.y && d.getMonth() + 1 === selectedMonth.m
    }).sort((a, b) => a.due_date.localeCompare(b.due_date))
  }, [companyRows, selectedMonth])

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const r of monthRows) {
      const arr = map.get(r.main_group) ?? []
      arr.push(r)
      map.set(r.main_group, arr)
    }
    const known = MAIN_GROUPS.filter(g => map.has(g)).map(g => [g, map.get(g)!] as const)
    const rest = [...map.entries()].filter(([g]) => !MAIN_GROUPS.includes(g))
    return [...known, ...rest]
  }, [monthRows])

  const summary = useMemo(() => {
    let completed = 0, inProgress = 0, notStarted = 0, overdue = 0
    for (const r of companyRows) {
      if (r.status === 'completed') { completed++; continue }
      if (daysUntil(r.due_date) < 0) { overdue++; continue }
      if (r.status === 'in_progress') inProgress++
      else notStarted++
    }
    return { total: companyRows.length, completed, inProgress, notStarted, overdue }
  }, [companyRows])

  return (
    <div className="bg-white border border-[#D7DCD1] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFF1EA]">
        <h2 className="font-semibold text-[#1C2320]">
          Annual Compliance Calendar (FY {fyFilter}-{String(fyFilter + 1).slice(-2)})
        </h2>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)}
          className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All Companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="flex gap-1 px-4 py-3 border-b border-[#EFF1EA] overflow-x-auto">
        {months.map((mm, i) => (
          <button key={i} onClick={() => setMonthIdx(i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium shrink-0 ${
              i === monthIdx ? 'bg-[#2E6F5C] text-white' : 'text-[#5B665D] hover:bg-[#EFF1EA]'
            }`}>
            {MONTH_SHORT[mm.m - 1]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px]">
        <div className="p-4 space-y-4 max-h-[520px] overflow-y-auto">
          {grouped.length === 0 ? (
            <p className="text-sm text-[#8A9389] py-8 text-center">No activities due this month.</p>
          ) : grouped.map(([group, items]) => (
            <div key={group}>
              <div className="text-xs font-semibold text-[#5B665D] uppercase tracking-wide mb-1.5">{group}</div>
              <div className="space-y-0.5">
                {items.map(row => {
                  const st = statusText(row)
                  return (
                    <button key={row.id} onClick={() => onSelect(row)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#EFF1EA] text-left">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor(row) }} />
                      <span className="flex-1 min-w-0 text-sm text-[#1C2320] truncate">
                        {row.activity_name}{row.period_label ? ` - ${row.period_label}` : ''}
                      </span>
                      <span className="text-xs text-[#5B665D] w-14 shrink-0">{formatDate(row.due_date)}</span>
                      <span className="text-xs font-medium w-24 shrink-0 text-right" style={{ color: st.color }}>{st.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-[#EFF1EA] p-4 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-[#5B665D] uppercase tracking-wide mb-2">Legend</h3>
            <div className="space-y-1.5 text-sm text-[#1C2320]">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: '#3F9142' }} /> Completed</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: '#B4801F' }} /> In Progress</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: '#8AA0B8' }} /> Not Started</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: '#B3472F' }} /> Overdue</div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#5B665D] uppercase tracking-wide mb-2">Annual Summary</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-[#5B665D]">Total Activities</span><span className="font-semibold text-[#1C2320]">{summary.total}</span></div>
              <div className="flex justify-between"><span className="text-[#5B665D]">Completed</span><span className="font-semibold" style={{ color: '#3F9142' }}>{summary.completed}</span></div>
              <div className="flex justify-between"><span className="text-[#5B665D]">In Progress</span><span className="font-semibold" style={{ color: '#B4801F' }}>{summary.inProgress}</span></div>
              <div className="flex justify-between"><span className="text-[#5B665D]">Not Started</span><span className="font-semibold" style={{ color: '#8AA0B8' }}>{summary.notStarted}</span></div>
              <div className="flex justify-between"><span className="text-[#5B665D]">Overdue</span><span className="font-semibold" style={{ color: '#B3472F' }}>{summary.overdue}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
