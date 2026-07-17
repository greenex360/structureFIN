'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMessages, sendMessage, type ChatMessage } from '@/lib/chat'
import { fetchTeam } from '@/lib/finActivities'

const LAST_READ_KEY = 'fin_chat_last_read_v2'
const TEAM_KEY = 'team'
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected'

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

function durationLabel(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

async function sendSignal(targetUserId: string, event: string, payload: any) {
  const ch = supabase.channel(`call-${targetUserId}`)
  await new Promise<void>(resolve => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event, payload })
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        resolve()
      }
    })
  })
  setTimeout(() => supabase.removeChannel(ch), 500)
}

export default function TeamChatWidget() {
  const [open, setOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState('')
  const [team, setTeam] = useState<any[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activeChat, setActiveChat] = useState<string>(TEAM_KEY)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [lastReadMap, setLastReadMap] = useState<Record<string, string>>(loadLastReadMap)
  const [loadError, setLoadError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // ── Voice call state ──
  const [callState, setCallState] = useState<CallState>('idle')
  const [remoteUser, setRemoteUser] = useState<{ id: string; name: string } | null>(null)
  const [incomingCall, setIncomingCall] = useState<{ callId: string; fromId: string; fromName: string; sdp: any } | null>(null)
  const [muted, setMuted] = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const callIdRef = useRef<string | null>(null)
  const queuedCandidatesRef = useRef<any[]>([])
  const callStateRef = useRef<CallState>('idle')
  const remoteUserRef = useRef<typeof remoteUser>(null)
  callStateRef.current = callState
  remoteUserRef.current = remoteUser

  useEffect(() => {
    loadIdentity()
    loadTeam()
    const teamTimer = setInterval(loadTeam, 15000)
    return () => clearInterval(teamTimer)
  }, [])

  async function loadIdentity() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoadError('Not signed in — please refresh the page.'); return }
      const { data, error } = await supabase.from('users').select('id, name').eq('email', user.email).single()
      if (error) throw error
      if (data) { setCurrentUserId(data.id); setCurrentUserName(data.name) }
    } catch (err: any) {
      setLoadError('Could not load your session — try refreshing the page.')
      console.error('[TeamChatWidget] identity load failed:', err)
    }
  }

  async function loadTeam() {
    try {
      const rows = await fetchTeam()
      setTeam(rows)
      setLoadError('')
    } catch (err: any) {
      setLoadError(`Could not load team: ${err.message}`)
      console.error('[TeamChatWidget] team load failed:', err)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [])

  async function load() {
    try {
      const rows = await fetchMessages()
      setMessages(rows)
      setLoadError('')
    } catch (err: any) {
      setLoadError(`Could not load messages: ${err.message}`)
      console.error('[TeamChatWidget] message load failed:', err)
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
    if (!draft.trim()) return
    if (!currentUserId) { alert('Not signed in yet — please refresh the page and try again.'); return }
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

  // ── Voice call wiring ──

  useEffect(() => {
    if (!currentUserId) return
    const channel = supabase.channel(`call-${currentUserId}`)
    channel
      .on('broadcast', { event: 'offer' }, ({ payload }) => {
        if (callStateRef.current !== 'idle') {
          sendSignal(payload.fromId, 'busy', { callId: payload.callId })
          return
        }
        setIncomingCall({ callId: payload.callId, fromId: payload.fromId, fromName: payload.fromName, sdp: payload.sdp })
        setCallState('ringing')
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.callId !== callIdRef.current || !pcRef.current) return
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        for (const c of queuedCandidatesRef.current) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)) } catch {}
        }
        queuedCandidatesRef.current = []
        setCallState('connected')
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.callId !== callIdRef.current) return
        if (pcRef.current?.remoteDescription) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate)) } catch {}
        } else {
          queuedCandidatesRef.current.push(payload.candidate)
        }
      })
      .on('broadcast', { event: 'hangup' }, ({ payload }) => {
        if (payload.callId !== callIdRef.current) return
        endCall(false)
      })
      .on('broadcast', { event: 'decline' }, ({ payload }) => {
        if (payload.callId !== callIdRef.current) return
        endCall(false)
      })
      .on('broadcast', { event: 'busy' }, ({ payload }) => {
        if (payload.callId !== callIdRef.current) return
        alert(`${remoteUserRef.current?.name ?? 'They'} are already on another call.`)
        endCall(false)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUserId])

  useEffect(() => {
    if (callState !== 'connected') { setCallSeconds(0); return }
    const start = Date.now()
    const timer = setInterval(() => setCallSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [callState])

  function createPeerConnection(targetUserId: string, callId: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.onicecandidate = e => {
      if (e.candidate) sendSignal(targetUserId, 'ice-candidate', { callId, candidate: e.candidate })
    }
    pc.ontrack = e => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0]
    }
    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState) && callStateRef.current !== 'idle') {
        endCall(false)
      }
    }
    return pc
  }

  async function startCall(targetUserId: string, targetName: string) {
    if (callState !== 'idle' || !currentUserId) return
    const callId = crypto.randomUUID()
    callIdRef.current = callId
    setRemoteUser({ id: targetUserId, name: targetName })
    setCallState('calling')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
      const pc = createPeerConnection(targetUserId, callId)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      pcRef.current = pc
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await sendSignal(targetUserId, 'offer', { callId, sdp: offer, fromId: currentUserId, fromName: currentUserName })
    } catch (err: any) {
      alert('Could not start call: ' + (err.message ?? 'microphone permission denied'))
      endCall(false)
    }
  }

  async function acceptCall() {
    if (!incomingCall || !currentUserId) return
    const { fromId, fromName, sdp, callId } = incomingCall
    callIdRef.current = callId
    setRemoteUser({ id: fromId, name: fromName })
    setCallState('connecting')
    setIncomingCall(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
      const pc = createPeerConnection(fromId, callId)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      pcRef.current = pc
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      for (const c of queuedCandidatesRef.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
      }
      queuedCandidatesRef.current = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendSignal(fromId, 'answer', { callId, sdp: answer })
      setCallState('connected')
    } catch (err: any) {
      alert('Could not answer call: ' + (err.message ?? 'microphone permission denied'))
      endCall(true)
    }
  }

  function declineCall() {
    if (!incomingCall) return
    sendSignal(incomingCall.fromId, 'decline', { callId: incomingCall.callId })
    setIncomingCall(null)
    setCallState('idle')
  }

  function endCall(shouldNotify: boolean) {
    if (shouldNotify && remoteUserRef.current && callIdRef.current) {
      sendSignal(remoteUserRef.current.id, 'hangup', { callId: callIdRef.current })
    }
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    queuedCandidatesRef.current = []
    callIdRef.current = null
    setCallState('idle')
    setRemoteUser(null)
    setIncomingCall(null)
    setMuted(false)
  }

  function toggleMute() {
    if (!localStreamRef.current) return
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = muted })
    setMuted(m => !m)
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <audio ref={remoteAudioRef} autoPlay />

      {/* Incoming call — visible regardless of chat panel open/closed */}
      {callState === 'ringing' && incomingCall && (
        <div className="w-80 bg-white border border-[#2E6F5C] rounded-xl shadow-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#2E6F5C] text-white font-bold flex items-center justify-center animate-pulse">
              {initials(incomingCall.fromName)}
            </div>
            <div>
              <div className="font-semibold text-sm text-[#1C2320]">{incomingCall.fromName}</div>
              <div className="text-xs text-[#5B665D]">Incoming voice call…</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={acceptCall} className="flex-1 px-3 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
              📞 Accept
            </button>
            <button onClick={declineCall} className="flex-1 px-3 py-2 bg-[#B3472F] text-white rounded-lg text-sm hover:bg-[#94371F]">
              ✕ Decline
            </button>
          </div>
        </div>
      )}

      {/* Outgoing / active call bar */}
      {(callState === 'calling' || callState === 'connecting' || callState === 'connected') && remoteUser && (
        <div className="w-80 bg-white border border-[#D7DCD1] rounded-xl shadow-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#2E6F5C] text-white font-bold flex items-center justify-center">
              {initials(remoteUser.name)}
            </div>
            <div>
              <div className="font-semibold text-sm text-[#1C2320]">{remoteUser.name}</div>
              <div className="text-xs text-[#5B665D]">
                {callState === 'calling' && 'Calling…'}
                {callState === 'connecting' && 'Connecting…'}
                {callState === 'connected' && durationLabel(callSeconds)}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {callState === 'connected' && (
              <button onClick={toggleMute} className={`flex-1 px-3 py-2 rounded-lg text-sm border ${muted ? 'bg-[#F2E7D2] border-[#D9C295] text-[#8A6A1F]' : 'bg-white border-[#D7DCD1] text-[#5B665D]'}`}>
                {muted ? '🔇 Unmute' : '🎙️ Mute'}
              </button>
            )}
            <button onClick={() => endCall(true)} className="flex-1 px-3 py-2 bg-[#B3472F] text-white rounded-lg text-sm hover:bg-[#94371F]">
              ✕ {callState === 'calling' ? 'Cancel' : 'End Call'}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="w-80 sm:w-[420px] h-[520px] bg-white border border-[#D7DCD1] rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#2E6F5C] text-white shrink-0">
            <span className="font-semibold text-sm">💬 {activeName}</span>
            <div className="flex items-center gap-3">
              {activeChat !== TEAM_KEY && callState === 'idle' && (
                <button onClick={() => startCall(activeChat, activeName)} className="text-white/80 hover:text-white text-sm" title={`Call ${activeName}`}>
                  📞
                </button>
              )}
              <button onClick={toggleOpen} className="text-white/80 hover:text-white text-sm">✕</button>
            </div>
          </div>

          {loadError && (
            <div className="px-3 py-2 bg-[#F3E1DB] text-[#B3472F] text-xs shrink-0 flex items-center justify-between gap-2">
              <span>⚠️ {loadError}</span>
              <button onClick={loadTeam} className="underline shrink-0">Retry</button>
            </div>
          )}

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
