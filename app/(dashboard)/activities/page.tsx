'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchActivityInstances, fetchActivityMaster, bulkUpdateStatus, bulkReassign, bulkChangeGroup, fetchTeam, MAIN_GROUPS } from '@/lib/finActivities'
import { formatDate, daysUntil, getStatusColor, getStatusLabel, getPriorityColor } from '@/lib/utils'
import { fyStartYearForDate, currentFYStartYear } from '@/lib/dueDateEngine'
import InstantUpdateModal from '@/components/InstantUpdateModal'
import AddActivityModal from '@/components/AddActivityModal'
import GenerateActivitiesModal from '@/components/GenerateActivitiesModal'

const todayStr = () => new Date().toISOString().split('T')[0]

export default function ActivitiesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scope = searchParams.get('scope') ?? 'all'
  const groupFilter = searchParams.get('group') ?? ''
  const groupsFilter = searchParams.get('groups')
  const groupsList = useMemo(() => groupsFilter ? groupsFilter.split(',') : null, [groupsFilter])
  const umbrellaLabel = searchParams.get('umbrella') ?? ''
  const dueToday = searchParams.get('due') === 'today'

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState(dueToday ? '' : 'not_started')
  const [fyFilter, setFyFilter] = useState('')
  const [dueOnOrBeforeToday, setDueOnOrBeforeToday] = useState(dueToday)
  const [selected, setSelected] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)
  const [team, setTeam] = useState<any[]>([])
  const [reassignTo, setReassignTo] = useState('')
  const [changeGroupTo, setChangeGroupTo] = useState('')

  useEffect(() => { loadUser(); fetchTeam().then(setTeam) }, [])
  useEffect(() => { load() }, [scope, currentUserId])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('users').select('id').eq('email', user.email).single()
    if (data) setCurrentUserId(data.id)
  }

  async function load() {
    setLoading(true)
    const { data } = await fetchActivityInstances(scope === 'mine' && currentUserId ? { assignedTo: currentUserId } : undefined)
    setRows(data)
    setCheckedIds(new Set())
    const { data: t } = await fetchActivityMaster()
    setTemplates(t.filter((x: any) => x.is_active))
    setLoading(false)
  }

  const fyOptions = useMemo(() => {
    const cur = currentFYStartYear()
    return [cur - 1, cur, cur + 1]
  }, [])

  const filtered = useMemo(() => {
    let out = rows
    if (groupFilter) out = out.filter(r => r.main_group === groupFilter)
    if (groupsList) out = out.filter(r => groupsList.includes(r.main_group))
    if (statusFilter) out = out.filter(r => r.status === statusFilter)
    if (fyFilter) out = out.filter(r => String(fyStartYearForDate(r.due_date)) === fyFilter)
    if (dueOnOrBeforeToday) out = out.filter(r => r.due_date <= todayStr())
    return out
  }, [rows, groupFilter, groupsList, statusFilter, fyFilter, dueOnOrBeforeToday])

  const allChecked = filtered.length > 0 && filtered.every(r => checkedIds.has(r.id))

  function toggleAll() {
    if (allChecked) { setCheckedIds(new Set()); return }
    setCheckedIds(new Set(filtered.map(r => r.id)))
  }

  function toggleOne(id: string) {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkComplete() {
    if (checkedIds.size === 0) return
    if (!window.confirm(`Mark ${checkedIds.size} activit${checkedIds.size === 1 ? 'y' : 'ies'} as Completed?`)) return
    setBulkRunning(true)
    try {
      await bulkUpdateStatus([...checkedIds], 'completed')
      await load()
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleBulkReassign() {
    if (checkedIds.size === 0 || !reassignTo) return
    setBulkRunning(true)
    try {
      await bulkReassign([...checkedIds], reassignTo)
      await load()
      setReassignTo('')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleBulkChangeGroup() {
    if (checkedIds.size === 0 || !changeGroupTo) return
    setBulkRunning(true)
    try {
      await bulkChangeGroup([...checkedIds], changeGroupTo)
      await load()
      setChangeGroupTo('')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setBulkRunning(false)
    }
  }

  function dueBadge(row: any) {
    if (row.status === 'completed') return null
    const d = daysUntil(row.due_date)
    if (d < 0) return <span className="text-xs font-medium text-[#B3472F]">{Math.abs(d)}d overdue</span>
    if (d === 0) return <span className="text-xs font-medium text-[#B4801F]">Due today</span>
    return <span className="text-xs text-[#8A9389]">in {d}d</span>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1C2320]">
            {groupFilter || umbrellaLabel || (scope === 'mine' ? 'My Work' : 'All Activities')}
          </h1>
          <p className="text-sm text-[#5B665D] mt-1">
            {filtered.length} activit{filtered.length === 1 ? 'y' : 'ies'}
            {(groupFilter || groupsList) && (
              <button onClick={() => router.push(scope === 'mine' ? '/activities?scope=mine' : '/activities')} className="ml-2 text-[#2E6F5C] underline">
                clear filter
              </button>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push(scope === 'mine' ? '/activities' : '/activities?scope=mine')}
            className="px-4 py-2 border border-[#D7DCD1] rounded-lg text-sm bg-white hover:bg-[#EFF1EA]">
            {scope === 'mine' ? 'View All' : 'View Mine'}
          </button>
          <button onClick={() => setShowGenerate(true)} className="px-4 py-2 border border-[#2E6F5C] text-[#2E6F5C] rounded-lg text-sm bg-white hover:bg-[#DEEAE4]">
            ⚡ Generate Activities
          </button>
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
            + Add Activity
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {['', 'not_started', 'in_progress', 'pending_review', 'completed'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${statusFilter === s ? 'bg-[#2E6F5C] text-white border-[#2E6F5C]' : 'bg-white text-[#5B665D] border-[#D7DCD1]'}`}>
            {s ? getStatusLabel(s) : 'All'}
          </button>
        ))}
        <span className="w-px h-5 bg-[#D7DCD1] mx-1" />
        <select value={fyFilter} onChange={e => setFyFilter(e.target.value)}
          className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-xs bg-white">
          <option value="">All Financial Years</option>
          {fyOptions.map(y => <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>)}
        </select>
        <button onClick={() => setDueOnOrBeforeToday(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${dueOnOrBeforeToday ? 'bg-[#2E6F5C] text-white border-[#2E6F5C]' : 'bg-white text-[#5B665D] border-[#D7DCD1]'}`}>
          Due today or earlier
        </button>
      </div>

      {checkedIds.size > 0 && (
        <div className="flex items-center justify-between bg-[#DEEAE4] border border-[#2E6F5C] rounded-lg px-4 py-2.5 flex-wrap gap-2">
          <span className="text-sm text-[#17352B] font-medium">{checkedIds.size} selected</span>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
              className="border border-[#2E6F5C] rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">Reassign to...</option>
              {team.map((t: any) => <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>)}
            </select>
            <button onClick={handleBulkReassign} disabled={bulkRunning || !reassignTo}
              className="px-3 py-1.5 bg-white border border-[#2E6F5C] text-[#2E6F5C] rounded-lg text-xs hover:bg-[#EFF1EA] disabled:opacity-50">
              {bulkRunning ? 'Working...' : '👤 Reassign Selected'}
            </button>
            <select value={changeGroupTo} onChange={e => setChangeGroupTo(e.target.value)}
              className="border border-[#2E6F5C] rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="">Change group to...</option>
              {MAIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button onClick={handleBulkChangeGroup} disabled={bulkRunning || !changeGroupTo}
              className="px-3 py-1.5 bg-white border border-[#2E6F5C] text-[#2E6F5C] rounded-lg text-xs hover:bg-[#EFF1EA] disabled:opacity-50">
              {bulkRunning ? 'Working...' : '📁 Change Group'}
            </button>
            <button onClick={handleBulkComplete} disabled={bulkRunning}
              className="px-3 py-1.5 bg-[#2E6F5C] text-white rounded-lg text-xs hover:bg-[#255A4A]">
              {bulkRunning ? 'Marking...' : '✓ Mark Selected Completed'}
            </button>
            <button onClick={() => setCheckedIds(new Set())} className="px-3 py-1.5 border border-[#2E6F5C] text-[#2E6F5C] rounded-lg text-xs bg-white">
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#D7DCD1] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#EFF1EA] text-[#5B665D] text-xs">
            <tr>
              <th className="px-4 py-3 text-center w-10">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th className="px-4 py-3 text-left">Activity</th>
              <th className="px-4 py-3 text-left">Group</th>
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">Due</th>
              <th className="px-4 py-3 text-left">Assigned To</th>
              <th className="px-4 py-3 text-center">Priority</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-10 text-[#8A9389]">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-10 text-[#8A9389]">Nothing here</td></tr>
            ) : (
              filtered.map(row => (
                <tr key={row.id} className={`border-t border-[#EFF1EA] hover:bg-[#EFF1EA] ${checkedIds.has(row.id) ? 'bg-[#F3F7F1]' : ''}`}>
                  <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checkedIds.has(row.id)} onChange={() => toggleOne(row.id)} />
                  </td>
                  <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(row)}>
                    <div className="font-medium text-[#1C2320]">{row.activity_name}</div>
                    {row.period_label && <div className="text-xs text-[#8A9389]">{row.period_label}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#5B665D] cursor-pointer" onClick={() => setSelected(row)}>{row.main_group}</td>
                  <td className="px-4 py-3 text-[#5B665D] cursor-pointer" onClick={() => setSelected(row)}>{row.company?.name ?? '—'}</td>
                  <td className="px-4 py-3 cursor-pointer" onClick={() => setSelected(row)}>
                    <div className="text-[#1C2320]">{formatDate(row.due_date)}</div>
                    {dueBadge(row)}
                  </td>
                  <td className="px-4 py-3 text-[#5B665D] cursor-pointer" onClick={() => setSelected(row)}>{row.assignee?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-center cursor-pointer" onClick={() => setSelected(row)}>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(row.priority)}`}>{row.priority}</span>
                  </td>
                  <td className="px-4 py-3 text-center cursor-pointer" onClick={() => setSelected(row)}>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}>{getStatusLabel(row.status)}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <InstantUpdateModal instance={selected} onClose={() => setSelected(null)} onSaved={load} />
      )}
      {showAdd && (
        <AddActivityModal templates={templates} currentUserId={currentUserId} onClose={() => setShowAdd(false)} onSaved={load} />
      )}
      {showGenerate && (
        <GenerateActivitiesModal currentUserId={currentUserId} onClose={() => setShowGenerate(false)} onGenerated={load} />
      )}
    </div>
  )
}
