'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMessages, sendMessage, type ChatMessage } from '@/lib/chat'
import { fetchTeam } from '@/lib/finActivities'

const LAST_READ_KEY = 'fin_chat_last_read_v2'
const TEAM_KEY = 'team'

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (sameDay) return time
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · ${time}`
}

function loadLastReadMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') } catch { return {} }
}

export default function TeamChatWidget() {
  const [open, setOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [team, setTeam] = useState<any[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeChat, setActiveChat] = useState<string>(TEAM_KEY)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [lastReadMap, setLastReadMap] = useState<Record<string, string>>(loadLastReadMap)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('users').select('id').eq('email', user.email).single()
      if (data) setCurrentUserId(data.id)
    })
    fetchTeam().then(setTeam)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [])

  async function load() {
    try {
      const rows = await fetchMessages()
      setMessages(rows)
    } catch {
      // silent — polling retry will pick it up
    }
  }

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, open, activeChat])

  function markRead(key: string) {
    const now = new Date().toISOString()
    setLastReadMap(prev => {
      const next = { ...prev, [key]: now }
      localStorage.setItem(LAST_READ_KEY, JSON.stringify(next))
      return next
    })
  }

  function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) markRead(activeChat)
  }

  function switchChat(key: string) {
    setActiveChat(key)
    markRead(key)
  }

  async function handleSend() {
    if (!draft.trim() || !currentUserId) return
    setSending(true)
    try {
      await sendMessage(currentUserId, draft, activeChat === TEAM_KEY ? null : activeChat)
      setDraft('')
      await load()
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setSending(false)
    }
  }

  const otherTeam = useMemo(() => team.filter((t: any) => t.user_id !== currentUserId), [team, currentUserId])

  function unreadFor(key: string) {
    const lastRead = lastReadMap[key] ?? ''
    const relevant = key === TEAM_KEY
      ? messages.filter(m => m.recipient_id === null && m.sender_id !== currentUserId)
      : messages.filter(m => m.sender_id === key && m.recipient_id === currentUserId)
    return relevant.filter(m => m.created_at > lastRead).length
  }

  const totalUnread = useMemo(
    () => unreadFor(TEAM_KEY) + otherTeam.reduce((sum: number, t: any) => sum + unreadFor(t.user_id), 0),
    [messages, lastReadMap, otherTeam, currentUserId]
  )

  const visibleMessages = useMemo(() => {
    if (activeChat === TEAM_KEY) return messages.filter(m => m.recipient_id === null)
    return messages.filter(m =>
      (m.sender_id === currentUserId && m.recipient_id === activeChat) ||
      (m.sender_id === activeChat && m.recipient_id === currentUserId)
    )
  }, [messages, activeChat, currentUserId])

  const activeName = activeChat === TEAM_KEY
    ? 'Team'
    : otherTeam.find((t: any) => t.user_id === activeChat)?.user?.name ?? 'Direct Message'

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open && (
        <div className="mb-3 w-80 sm:w-[420px] h-[520px] bg-white border border-[#D7DCD1] rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#2E6F5C] text-white shrink-0">
            <span className="font-semibold text-sm">💬 {activeName}</span>
            <button onClick={toggleOpen} className="text-white/80 hover:text-white text-sm">✕</button>
          </div>

          <div className="flex gap-1.5 px-3 py-2 border-b border-[#EFF1EA] overflow-x-auto shrink-0">
            <button onClick={() => switchChat(TEAM_KEY)}
              className={`relative px-3 py-1.5 rounded-full text-xs font-medium shrink-0 ${
                activeChat === TEAM_KEY ? 'bg-[#2E6F5C] text-white' : 'bg-[#EFF1EA] text-[#5B665D] hover:bg-[#DEEAE4]'
              }`}>
              # Team
              {unreadFor(TEAM_KEY) > 0 && activeChat !== TEAM_KEY && (
                <span className="absolute -top-1 -right-1 bg-[#B3472F] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {unreadFor(TEAM_KEY)}
                </span>
              )}
            </button>
            {otherTeam.map((t: any) => (
              <button key={t.user_id} onClick={() => switchChat(t.user_id)}
                className={`relative px-3 py-1.5 rounded-full text-xs font-medium shrink-0 ${
                  activeChat === t.user_id ? 'bg-[#2E6F5C] text-white' : 'bg-[#EFF1EA] text-[#5B665D] hover:bg-[#DEEAE4]'
                }`}>
                {t.user?.name?.split(' ')[0] ?? '—'}
                {unreadFor(t.user_id) > 0 && activeChat !== t.user_id && (
                  <span className="absolute -top-1 -right-1 bg-[#B3472F] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {unreadFor(t.user_id)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-[#F5F6F1]">
            {visibleMessages.length === 0 ? (
              <p className="text-xs text-[#8A9389] text-center py-8">
                {activeChat === TEAM_KEY ? 'No messages yet — say hello 👋' : `No messages with ${activeName} yet.`}
              </p>
            ) : visibleMessages.map(m => {
              const mine = m.sender_id === currentUserId
              return (
                <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  <div className="w-7 h-7 rounded-full bg-[#2E6F5C] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                    {initials(m.sender?.name ?? '?')}
                  </div>
                  <div className={`max-w-[75%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                    {!mine && activeChat === TEAM_KEY && <span className="text-[10px] text-[#5B665D] mb-0.5 px-1">{m.sender?.name ?? 'Unknown'}</span>}
                    <div className={`px-3 py-1.5 rounded-2xl text-sm break-words ${
                      mine ? 'bg-[#2E6F5C] text-white rounded-br-sm' : 'bg-white border border-[#D7DCD1] text-[#1C2320] rounded-bl-sm'
                    }`}>
                      {m.message}
                    </div>
                    <span className="text-[10px] text-[#8A9389] mt-0.5 px-1">{timeLabel(m.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="p-2.5 border-t border-[#EFF1EA] flex gap-2 shrink-0">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={activeChat === TEAM_KEY ? 'Message the team...' : `Message ${activeName}...`}
              className="flex-1 border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className="px-3 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A] disabled:opacity-50"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      <button
        onClick={toggleOpen}
        className="w-14 h-14 rounded-full bg-[#2E6F5C] text-white shadow-lg flex items-center justify-center text-2xl hover:bg-[#255A4A] relative"
      >
        💬
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 bg-[#B3472F] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        )}
      </button>
    </div>
  )
}
