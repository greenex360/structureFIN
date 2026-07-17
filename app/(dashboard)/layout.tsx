'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import TeamChatWidget from '@/components/TeamChatWidget'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setChecking(false)
    }
    checkSession()
  }, [])

  if (checking) return (
    <div className="flex items-center justify-center min-h-screen bg-[#F5F6F1]">
      <div className="text-[#8A9389] text-sm">Loading...</div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[#F5F6F1]">
      <Sidebar />
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      <TeamChatWidget />
    </div>
  )
}
