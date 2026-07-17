'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchGroupCounts } from '@/lib/finActivities'

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { label: 'My Work', href: '/activities?scope=mine', icon: '✅' },
  { label: 'All Activities', href: '/activities', icon: '📋' },
  { label: 'Activity Master', href: '/activity-master', icon: '🗂️' },
  { label: 'Team', href: '/team', icon: '👥' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeGroup = searchParams.get('group')

  const [groups, setGroups] = useState<[string, number][]>([])
  const [groupsOpen, setGroupsOpen] = useState(true)

  useEffect(() => {
    fetchGroupCounts().then(setGroups)
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-60 bg-[#11150F] text-[#EBEFE8] flex flex-col h-screen fixed left-0 top-0 z-40">
      <div className="px-6 py-5 border-b border-[#2A3128] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#2E6F5C] text-white flex items-center justify-center text-sm font-bold">S</div>
          <span className="text-lg font-bold tracking-tight">StructureFIN</span>
        </div>
        <div className="text-xs text-[#6E7A6D] mt-1">Finance Operations Suite</div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {navItems.map((item) => {
          const base = item.href.split('?')[0]
          const active = (pathname === base || pathname.startsWith(base + '/')) && !activeGroup
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 mx-2 px-4 py-2.5 rounded-lg mb-0.5 text-sm transition-colors ${
                active ? 'bg-[#2E6F5C] text-white' : 'text-[#9BA79A] hover:bg-[#1E241C] hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          )
        })}

        <button
          onClick={() => setGroupsOpen(v => !v)}
          className="w-full flex items-center justify-between px-6 py-2 mt-3 text-xs font-semibold text-[#6E7A6D] uppercase tracking-wider"
        >
          <span>By Group</span>
          <span className={`transition-transform ${groupsOpen ? 'rotate-90' : ''}`}>›</span>
        </button>
        {groupsOpen && (
          <div>
            {groups.length === 0 ? (
              <p className="px-6 py-2 text-xs text-[#6E7A6D]">No open activities yet</p>
            ) : (
              groups.map(([group, count]) => {
                const active = pathname === '/activities' && activeGroup === group
                return (
                  <Link
                    key={group}
                    href={`/activities?group=${encodeURIComponent(group)}`}
                    className={`flex items-center justify-between mx-2 px-4 py-2 rounded-lg mb-0.5 text-xs transition-colors ${
                      active ? 'bg-[#2E6F5C] text-white' : 'text-[#9BA79A] hover:bg-[#1E241C] hover:text-white'
                    }`}
                  >
                    <span className="truncate">{group}</span>
                    <span className={`shrink-0 ml-2 px-1.5 rounded-full text-[10px] ${active ? 'bg-white/20' : 'bg-[#2A3128]'}`}>{count}</span>
                  </Link>
                )
              })
            )}
          </div>
        )}
      </nav>
      <div className="px-4 py-4 border-t border-[#2A3128] shrink-0 space-y-1">
        <a
          href="/dashboard"
          className="w-full text-left px-4 py-2.5 text-sm text-[#9BA79A] hover:text-white hover:bg-[#1E241C] rounded-lg transition-colors flex items-center gap-2"
        >
          <span>💸</span>
          <span>Switch to StructurePay</span>
        </a>
        <button
          onClick={handleLogout}
          className="w-full text-left px-4 py-2.5 text-sm text-[#9BA79A] hover:text-white hover:bg-[#1E241C] rounded-lg transition-colors flex items-center gap-2"
        >
          <span>🚪</span>
          <span>Logout</span>
        </button>
      </div>
    </aside>
  )
}
