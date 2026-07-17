'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { daysUntil } from '@/lib/utils'

export default function Header() {
  const [userName, setUserName] = useState('')
  const [finRole, setFinRole] = useState('')
  const [attentionRows, setAttentionRows] = useState<any[]>([])
  const [now, setNow] = useState(new Date())
  const [showNotifications, setShowNotifications] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => { loadUser() }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowNotifications(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function loadUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: u } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', user.email)
      .single()

    if (u) {
      setUserName(u.name)

      const { data: roleRow } = await supabase
        .from('fin_user_roles')
        .select('fin_role')
        .eq('user_id', u.id)
        .single()
      if (roleRow) setFinRole(roleRow.fin_role)

      const today = new Date().toISOString().split('T')[0]
      const { data: rows } = await supabase
        .from('fin_activity_instances')
        .select('id, activity_name, main_group, due_date, period_label')
        .eq('assigned_to', u.id)
        .neq('status', 'completed')
        .lte('due_date', today)
        .order('due_date', { ascending: true })
        .limit(10)
      setAttentionRows(rows ?? [])
    }
  }

  function goToActivity() {
    setShowNotifications(false)
    router.push('/activities?scope=mine&due=today')
  }

  return (
    <header className="h-16 bg-white border-b border-[#D7DCD1] flex items-center justify-between px-6 shrink-0">
      <div className="text-sm text-[#5B665D]"></div>
      <div className="flex items-center gap-4">
        <span className="text-xs font-medium text-[#5B665D]">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {' · '}
          {now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
        </span>
        <div className="relative" ref={panelRef}>
          <button onClick={() => setShowNotifications(v => !v)} className="relative text-[#5B665D] hover:text-[#1C2320]">
            <span className="text-xl">🔔</span>
            {attentionRows.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#B3472F] text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {attentionRows.length > 9 ? '9+' : attentionRows.length}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-[#D7DCD1] rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-[#EFF1EA] font-semibold text-sm text-[#1C2320]">
                Needs your attention
              </div>
              <div className="max-h-80 overflow-y-auto">
                {attentionRows.length === 0 ? (
                  <p className="text-sm text-[#8A9389] text-center py-8">Nothing overdue or due today 🎉</p>
                ) : attentionRows.map(row => {
                  const d = daysUntil(row.due_date)
                  return (
                    <button key={row.id} onClick={goToActivity}
                      className="w-full text-left px-4 py-2.5 border-b border-[#EFF1EA] hover:bg-[#EFF1EA]">
                      <div className="text-sm font-medium text-[#1C2320] truncate">{row.activity_name}</div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs text-[#8A9389]">{row.main_group}{row.period_label ? ` · ${row.period_label}` : ''}</span>
                        <span className={`text-xs font-medium ${d < 0 ? 'text-[#B3472F]' : 'text-[#B4801F]'}`}>
                          {d < 0 ? `${Math.abs(d)}d overdue` : 'Due today'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
              {attentionRows.length > 0 && (
                <button onClick={goToActivity} className="w-full text-center px-4 py-2.5 text-sm text-[#2E6F5C] font-medium hover:bg-[#EFF1EA]">
                  View All
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#2E6F5C] text-white rounded-full flex items-center justify-center text-sm font-bold">
            {userName?.charAt(0)?.toUpperCase()}
          </div>
          <div className="hidden md:block">
            <div className="text-sm font-medium text-[#1C2320]">{userName}</div>
            <div className="text-xs text-[#5B665D]">{finRole || 'No role assigned'}</div>
          </div>
        </div>
      </div>
    </header>
  )
}
