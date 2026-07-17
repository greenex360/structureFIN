'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { FIN_ROLES, fetchTeam, fetchTemplateGroups, fetchGroupDefaults, upsertGroupDefault, applyGroupDefaultToExisting } from '@/lib/finActivities'

export default function TeamPage() {
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<Record<string, { fin_role: string; is_active: boolean }>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [team, setTeam] = useState<any[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [defaults, setDefaults] = useState<Record<string, { assigned_to: string; reviewer_id: string }>>({})
  const [savingGroup, setSavingGroup] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [checkingAccess, setCheckingAccess] = useState(true)

  useEffect(() => { checkAccess(); load() }, [])

  async function checkAccess() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCheckingAccess(false); return }
    const { data: u } = await supabase.from('users').select('id').eq('email', user.email).single()
    if (u) {
      const { data: roleRow } = await supabase.from('fin_user_roles').select('fin_role').eq('user_id', u.id).single()
      setIsAdmin(roleRow?.fin_role === 'Admin')
    }
    setCheckingAccess(false)
  }

  async function load() {
    setLoading(true)
    const { data: allUsers } = await supabase.from('users').select('id, name, email').order('name')
    const { data: roleRows } = await supabase.from('fin_user_roles').select('*')

    setUsers(allUsers ?? [])
    const map: Record<string, { fin_role: string; is_active: boolean }> = {}
    for (const r of roleRows ?? []) map[r.user_id] = { fin_role: r.fin_role, is_active: r.is_active }
    setRoles(map)
    setLoading(false)

    const [teamRows, groupNames, groupDefaultRows] = await Promise.all([
      fetchTeam(), fetchTemplateGroups(), fetchGroupDefaults(),
    ])
    setTeam(teamRows)
    setGroups(groupNames)
    const dMap: Record<string, { assigned_to: string; reviewer_id: string }> = {}
    for (const g of groupDefaultRows as any[]) {
      dMap[g.main_group] = { assigned_to: g.assigned_to ?? '', reviewer_id: g.reviewer_id ?? '' }
    }
    setDefaults(dMap)
  }

  function updateRole(userId: string, finRole: string) {
    setRoles(prev => ({ ...prev, [userId]: { fin_role: finRole, is_active: prev[userId]?.is_active ?? true } }))
  }

  async function saveRole(userId: string) {
    setSavingId(userId)
    const entry = roles[userId]
    if (!entry?.fin_role) { setSavingId(null); return }
    const { data, error } = await supabase.from('fin_user_roles').upsert(
      { user_id: userId, fin_role: entry.fin_role, is_active: true },
      { onConflict: 'user_id' }
    ).select('user_id')
    setSavingId(null)
    if (error) { alert('Error: ' + error.message); return }
    if (!data || data.length === 0) { alert('Save was blocked — only Admins can edit team roles.'); return }
    load()
  }

  function updateDefault(group: string, field: 'assigned_to' | 'reviewer_id', value: string) {
    setDefaults(prev => ({
      ...prev,
      [group]: {
        assigned_to: prev[group]?.assigned_to ?? '',
        reviewer_id: prev[group]?.reviewer_id ?? '',
        [field]: value,
      },
    }))
  }

  async function saveDefault(group: string) {
    setSavingGroup(group)
    const entry = defaults[group] ?? { assigned_to: '', reviewer_id: '' }
    try {
      await upsertGroupDefault(group, entry.assigned_to || null, entry.reviewer_id || null)
      const applyToExisting = confirm(
        `Saved. Apply this to "${group}" activities that are already generated and not yet completed too? (New activities will use it automatically either way.)`
      )
      if (applyToExisting) {
        const { updated } = await applyGroupDefaultToExisting(group, entry.assigned_to || null, entry.reviewer_id || null)
        alert(`Updated ${updated} existing activit${updated === 1 ? 'y' : 'ies'} in "${group}".`)
      }
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setSavingGroup(null)
      load()
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1C2320]">Team</h1>
        <p className="text-sm text-[#5B665D] mt-1">
          Assign a StructureFIN role to each team member, then set who owns each activity group by default.
          Manager and above can always reassign anything individually from Activities.
        </p>
      </div>

      {!checkingAccess && !isAdmin && (
        <div className="bg-[#F2E7D2] border border-[#D9C295] text-[#8A6A1F] rounded-lg px-4 py-2.5 text-sm">
          🔒 View only — only Admins can edit team roles and group defaults.
        </div>
      )}

      <div className="bg-white border border-[#D7DCD1] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EFF1EA]">
          <h2 className="font-semibold text-[#1C2320] text-sm">Team Roles</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#EFF1EA] text-[#5B665D] text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">StructureFIN Role</th>
              <th className="px-4 py-3 text-center w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-10 text-[#8A9389]">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-[#8A9389]">No users found</td></tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className="border-t border-[#EFF1EA]">
                  <td className="px-4 py-3 font-medium text-[#1C2320]">{u.name}</td>
                  <td className="px-4 py-3 text-[#5B665D]">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={roles[u.id]?.fin_role ?? ''}
                      onChange={e => updateRole(u.id, e.target.value)}
                      disabled={!isAdmin}
                      className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-sm disabled:bg-[#F5F6F1] disabled:text-[#8A9389]"
                    >
                      <option value="">— Not on StructureFIN —</option>
                      {FIN_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isAdmin && (
                      <button
                        onClick={() => saveRole(u.id)}
                        disabled={savingId === u.id}
                        className="px-3 py-1.5 bg-[#2E6F5C] text-white rounded-lg text-xs hover:bg-[#255A4A]"
                      >
                        {savingId === u.id ? 'Saving...' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#D7DCD1] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#EFF1EA]">
          <h2 className="font-semibold text-[#1C2320] text-sm">Group Defaults</h2>
          <p className="text-xs text-[#8A9389] mt-0.5">
            Who a new activity in each group is assigned to automatically when Generate Activities runs.
            Leave blank to fall back to whoever holds Accounts Executive.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#EFF1EA] text-[#5B665D] text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Group</th>
              <th className="px-4 py-3 text-left">Default Assignee</th>
              <th className="px-4 py-3 text-left">Default Reviewer</th>
              <th className="px-4 py-3 text-center w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-10 text-[#8A9389]">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-[#8A9389]">No Activity Master templates yet</td></tr>
            ) : (
              groups.map(group => (
                <tr key={group} className="border-t border-[#EFF1EA]">
                  <td className="px-4 py-3 font-medium text-[#1C2320]">{group}</td>
                  <td className="px-4 py-3">
                    <select
                      value={defaults[group]?.assigned_to ?? ''}
                      onChange={e => updateDefault(group, 'assigned_to', e.target.value)}
                      disabled={!isAdmin}
                      className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-sm disabled:bg-[#F5F6F1] disabled:text-[#8A9389]"
                    >
                      <option value="">— Falls back to Accounts Executive —</option>
                      {team.map((t: any) => <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={defaults[group]?.reviewer_id ?? ''}
                      onChange={e => updateDefault(group, 'reviewer_id', e.target.value)}
                      disabled={!isAdmin}
                      className="border border-[#D7DCD1] rounded-lg px-3 py-1.5 text-sm disabled:bg-[#F5F6F1] disabled:text-[#8A9389]"
                    >
                      <option value="">—</option>
                      {team.map((t: any) => <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isAdmin && (
                      <button
                        onClick={() => saveDefault(group)}
                        disabled={savingGroup === group}
                        className="px-3 py-1.5 bg-[#2E6F5C] text-white rounded-lg text-xs hover:bg-[#255A4A]"
                      >
                        {savingGroup === group ? 'Saving...' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
