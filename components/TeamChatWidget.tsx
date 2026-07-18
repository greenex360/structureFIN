'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMessages, sendMessage, type ChatMessage } from '@/lib/chat'
import { fetchTeam } from '@/lib/finActivities'

const LAST_READ_KEY = 'fin_chat_last_read_v2'
const TEAM_KEY = 'team'
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// Fetches fresh TURN credentials from our Metered.ca account before each
// call, rather than hardcoding servers - Metered's credentials are
// short-lived and this is their documented usage pattern. Falls back to
// STUN-only (direct connections still work on the same network) if the
// fetch fails for any reason, so a Metered outage doesn't hard-break calls.
async function fetchIceServers(): Promise<RTCIceServer[]> {
  const apiKey = process.env.NEXT_PUBLIC_METERED_API_KEY
  if (!apiKey) return FALLBACK_ICE_SERVERS
  try {
    const res = await fetch(`https://structurepay.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`)
    if (!res.ok) return FALLBACK_ICE_SERVERS
    const servers = await res.json()
    return Array.isArray(servers) && servers.length > 0 ? servers : FALLBACK_ICE_SERVERS
  } catch {
    return FALLBACK_ICE_SERVERS
  }
}

type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'failed'

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

// Outgoing signaling channels are expensive to open (a full websocket
// subscribe handshake each time), so we open ONE per call and reuse it for
// every message (offer/answer/every ICE candidate/hangup) instead of
// creating and tearing one down per message - that churn was dropping or
// badly delaying ICE candidates, which is why calls could connect but carry
// no audio. Keyed by callId (not targetUserId) so a delayed cleanup from a
// just-ended call can never tear down the channel a brand new call to the
// same person just started using.
const outgoingChannels = new Map<string, ReturnType<typeof supabase.channel>>()

async function getOutgoingChannel(targetUserId: string, callId: string) {
  const existing = outgoingChannels.get(callId)
  if (existing) return existing
  const ch = supabase.channel(`call-${targetUserId}`)
  await new Promise<void>(resolve => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve()
    })
  })
  outgoingChannels.set(callId, ch)
  return ch
}

function closeOutgoingChannel(callId: string) {
  const ch = outgoingChannels.get(callId)
  if (ch) {
    supabase.removeChannel(ch)
    outgoingChannels.delete(callId)
  }
}

async function sendSignal(targetUserId: string, callId: string, event: string, payload: any) {
  const ch = await getOutgoingChannel(targetUserId, callId)
  ch.send({ type: 'broadcast', event, payload })
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
  const [teamError, setTeamError] = useState('')
  const [messagesError, setMessagesError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const seenMessageIdsRef = useRef<Set<string> | null>(null)

  // ── Voice call state ──
  const [callState, setCallState] = useState<CallState>('idle')
  const [remoteUser, setRemoteUser] = useState<{ id: string; name: string } | null>(null)
  const [incomingCall, setIncomingCall] = useState<{ callId: string; fromId: string; fromName: string; sdp: any } | null>(null)
  const [muted, setMuted] = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)
  const [sentDebug, setSentDebug] = useState('')
  const [recvDebug, setRecvDebug] = useState('')
  const [iceStateDebug, setIceStateDebug] = useState('')
  const [ringDebug, setRingDebug] = useState('')
  const recvCountRef = useRef(0)
  const recvTypesRef = useRef<Set<string>>(new Set())
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const callIdRef = useRef<string | null>(null)
  const queuedCandidatesRef = useRef<any[]>([])
  const callStateRef = useRef<CallState>('idle')
  const remoteUserRef = useRef<typeof remoteUser>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const openRef = useRef(false)
  const ringAudioCtxRef = useRef<AudioContext | null>(null)
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  callStateRef.current = callState
  remoteUserRef.current = remoteUser
  currentUserIdRef.current = currentUserId
  openRef.current = open

  useEffect(() => {
    loadIdentity()
    loadTeam()
    const teamTimer = setInterval(loadTeam, 15000)
    return () => clearInterval(teamTimer)
  }, [])

  async function loadIdentity() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setTeamError('Not signed in — please refresh the page.'); return }
      const { data, error } = await supabase.from('users').select('id, name').eq('email', user.email).single()
      if (error) throw error
      if (data) { setCurrentUserId(data.id); setCurrentUserName(data.name) }
    } catch (err: any) {
      setTeamError('Could not load your session — try refreshing the page.')
      console.error('[TeamChatWidget] identity load failed:', err)
    }
  }

  async function loadTeam() {
    try {
      const rows = await fetchTeam()
      setTeam(rows)
      setTeamError('')
    } catch (err: any) {
      setTeamError(`Could not load team: ${err.message}`)
      console.error('[TeamChatWidget] team load failed:', err)
    }
  }

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 4000)
    return () => clearInterval(timer)
  }, [])

  function notifyNewMessages(rows: ChatMessage[]) {
    if (typeof Notification === 'undefined') return
    const seen = seenMessageIdsRef.current
    const currentIds = new Set(rows.map(r => r.id))
    if (seen === null) {
      // First load after mount — just record what's already there, don't
      // fire a notification storm for messages sent before we were open.
      seenMessageIdsRef.current = currentIds
      return
    }
    const newOnes = rows.filter(r => !seen.has(r.id) && r.sender_id !== currentUserIdRef.current)
    seenMessageIdsRef.current = currentIds
    if (newOnes.length === 0 || Notification.permission !== 'granted') return
    if (openRef.current && document.hasFocus()) return // already looking at the chat
    for (const m of newOnes) {
      const title = m.recipient_id === null ? `${m.sender?.name ?? 'Someone'} · Team Chat` : m.sender?.name ?? 'New message'
      const n = new Notification(title, { body: m.message })
      n.onclick = () => { window.focus(); n.close() }
    }
  }

  async function load() {
    try {
      const rows = await fetchMessages()
      notifyNewMessages(rows)
      setMessages(rows)
      setMessagesError('')
    } catch (err: any) {
      setMessagesError(`Could not load messages: ${err.message}`)
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
          sendSignal(payload.fromId, payload.callId, 'busy', { callId: payload.callId })
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
        setCallState('connecting') // becomes 'connected' once the peer connection actually succeeds
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.callId !== callIdRef.current) return
        recvCountRef.current++
        const m = /typ (\w+)/.exec(payload.candidate?.candidate ?? '')
        if (m) recvTypesRef.current.add(m[1])
        setRecvDebug(`recv ${recvCountRef.current} candidate${recvCountRef.current === 1 ? '' : 's'} (${[...recvTypesRef.current].join(', ') || '…'})`)
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

  useEffect(() => {
    if (callState === 'ringing') startRingtone()
    else stopRingtone()
    return stopRingtone
  }, [callState])

  // If signaling completes but the actual peer connection never comes up
  // (e.g. both sides behind NATs the TURN relay couldn't bridge), don't
  // leave the UI stuck showing "Connecting..." forever with no explanation.
  useEffect(() => {
    if (callState !== 'connecting') return
    const timeout = setTimeout(() => {
      if (callStateRef.current === 'connecting') {
        setCallState('failed')
        setTimeout(() => endCall(false), 3000)
      }
    }, 20000)
    return () => clearTimeout(timeout)
  }, [callState])

  // Web Audio (used for the ring tone) can be silently blocked by the
  // browser until the page has seen at least one user interaction. Resume
  // it as soon as that happens so a ring that started before any click
  // still becomes audible.
  useEffect(() => {
    function resumeAudio() {
      if (ringAudioCtxRef.current?.state === 'suspended') ringAudioCtxRef.current.resume().catch(() => {})
    }
    document.addEventListener('click', resumeAudio)
    document.addEventListener('keydown', resumeAudio)
    return () => {
      document.removeEventListener('click', resumeAudio)
      document.removeEventListener('keydown', resumeAudio)
    }
  }, [])

  function startRingtone() {
    stopRingtone()
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new Ctx()
      ringAudioCtxRef.current = ctx
      setRingDebug(`audio: ${ctx.state}`)
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => setRingDebug(`audio: ${ctx.state} (resumed)`)).catch((err: any) => setRingDebug(`audio: resume failed — ${err?.message ?? err}`))
      }
      const beep = () => {
        if (!ringAudioCtxRef.current) return
        [0, 0.3].forEach(delay => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = 900
          const t = ctx.currentTime + delay
          gain.gain.setValueAtTime(0.0001, t)
          gain.gain.exponentialRampToValueAtTime(0.25, t + 0.05)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(t)
          osc.stop(t + 0.25)
        })
      }
      beep()
      ringIntervalRef.current = setInterval(beep, 1500)
    } catch (err: any) {
      setRingDebug(`audio: failed to start — ${err?.message ?? err}`)
      console.error('[call] ringtone failed:', err)
    }
  }

  function stopRingtone() {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null }
    if (ringAudioCtxRef.current) { ringAudioCtxRef.current.close().catch(() => {}); ringAudioCtxRef.current = null }
    setRingDebug('')
  }

  function createPeerConnection(targetUserId: string, callId: string, iceServers: RTCIceServer[]) {
    recvCountRef.current = 0
    recvTypesRef.current = new Set()
    setRecvDebug('')
    setIceStateDebug('')
    const pc = new RTCPeerConnection({ iceServers })
    const localTypes = new Set<string>()
    let candidateCount = 0
    setSentDebug('gathering…')
    pc.onicecandidate = e => {
      if (e.candidate) {
        candidateCount++
        const m = /typ (\w+)/.exec(e.candidate.candidate)
        if (m) localTypes.add(m[1])
        setSentDebug(`sent ${candidateCount} candidate${candidateCount === 1 ? '' : 's'} (${[...localTypes].join(', ') || '…'})`)
        // Explicitly extract fields rather than sending the RTCIceCandidate
        // instance directly - sdpMid/sdpMLineIndex (needed to associate the
        // candidate with the right media line) can silently fail to survive
        // JSON serialization of the instance itself in some browsers, which
        // would make every received candidate look fine but be unusable.
        sendSignal(targetUserId, callId, 'ice-candidate', {
          callId,
          candidate: {
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
            usernameFragment: e.candidate.usernameFragment,
          },
        })
      }
    }
    pc.ontrack = e => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0]
        remoteAudioRef.current.play().catch(() => {}) // autoplay can be blocked even with the attribute
      }
    }
    pc.oniceconnectionstatechange = () => {
      console.log('[call] iceConnectionState:', pc.iceConnectionState)
      setIceStateDebug(`ICE: ${pc.iceConnectionState}`)
    }
    pc.onconnectionstatechange = () => {
      console.log('[call] connectionState:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        setCallState('connected')
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState) && callStateRef.current !== 'idle' && callStateRef.current !== 'failed') {
        setCallState('failed')
        setTimeout(() => endCall(false), 3000)
      }
    }
    return pc
  }

  async function startCall(targetUserId: string, targetName: string) {
    if (!currentUserId) { alert('Not signed in yet — please refresh the page and try again.'); return }
    if (callState !== 'idle') { alert('You are already in a call. End it before starting a new one.'); return }
    if (!navigator.mediaDevices?.getUserMedia) { alert('This browser does not support voice calls (no microphone access API).'); return }
    const callId = crypto.randomUUID()
    callIdRef.current = callId
    setRemoteUser({ id: targetUserId, name: targetName })
    setCallState('calling')
    try {
      const [stream, iceServers] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        fetchIceServers(),
      ])
      localStreamRef.current = stream
      const pc = createPeerConnection(targetUserId, callId, iceServers)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      pcRef.current = pc
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await sendSignal(targetUserId, callId, 'offer', { callId, sdp: { type: offer.type, sdp: offer.sdp }, fromId: currentUserId, fromName: currentUserName })
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
      const [stream, iceServers] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        fetchIceServers(),
      ])
      localStreamRef.current = stream
      const pc = createPeerConnection(fromId, callId, iceServers)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      pcRef.current = pc
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      for (const c of queuedCandidatesRef.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
      }
      queuedCandidatesRef.current = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await sendSignal(fromId, callId, 'answer', { callId, sdp: { type: answer.type, sdp: answer.sdp } })
      // stays 'connecting' — onconnectionstatechange flips it to 'connected' once the peer connection actually succeeds
    } catch (err: any) {
      alert('Could not answer call: ' + (err.message ?? 'microphone permission denied'))
      endCall(true)
    }
  }

  function declineCall() {
    if (!incomingCall) return
    const { fromId, callId } = incomingCall
    sendSignal(fromId, callId, 'decline', { callId })
    setTimeout(() => closeOutgoingChannel(callId), 1000)
    setIncomingCall(null)
    setCallState('idle')
  }

  function endCall(shouldNotify: boolean) {
    const targetId = remoteUserRef.current?.id
    const thisCallId = callIdRef.current
    if (shouldNotify && targetId && thisCallId) {
      sendSignal(targetId, thisCallId, 'hangup', { callId: thisCallId })
    }
    if (thisCallId) setTimeout(() => closeOutgoingChannel(thisCallId), 1000)
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
    setSentDebug('')
    setRecvDebug('')
    setIceStateDebug('')
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
              {ringDebug && <div className="text-[10px] text-[#8A9389] mt-0.5">{ringDebug}</div>}
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
      {(callState === 'calling' || callState === 'connecting' || callState === 'connected' || callState === 'failed') && remoteUser && (
        <div className={`w-80 bg-white border rounded-xl shadow-xl p-4 space-y-3 ${callState === 'failed' ? 'border-[#B3472F]' : 'border-[#D7DCD1]'}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#2E6F5C] text-white font-bold flex items-center justify-center">
              {initials(remoteUser.name)}
            </div>
            <div>
              <div className="font-semibold text-sm text-[#1C2320]">{remoteUser.name}</div>
              <div className={`text-xs ${callState === 'failed' ? 'text-[#B3472F] font-medium' : 'text-[#5B665D]'}`}>
                {callState === 'calling' && 'Calling…'}
                {callState === 'connecting' && 'Connecting…'}
                {callState === 'connected' && durationLabel(callSeconds)}
                {callState === 'failed' && '⚠️ Call failed to connect — check your network'}
              </div>
              {(callState === 'connecting' || callState === 'failed') && (
                <div className="text-[10px] text-[#8A9389] mt-0.5 space-y-0.5">
                  {iceStateDebug && <div>{iceStateDebug}</div>}
                  {sentDebug && <div>{sentDebug}</div>}
                  {recvDebug ? <div>{recvDebug}</div> : <div className="text-[#B3472F]">recv: nothing from the other side yet</div>}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {callState === 'connected' && (
              <button onClick={toggleMute} className={`flex-1 px-3 py-2 rounded-lg text-sm border ${muted ? 'bg-[#F2E7D2] border-[#D9C295] text-[#8A6A1F]' : 'bg-white border-[#D7DCD1] text-[#5B665D]'}`}>
                {muted ? '🔇 Unmute' : '🎙️ Mute'}
              </button>
            )}
            <button onClick={() => endCall(true)} className="flex-1 px-3 py-2 bg-[#B3472F] text-white rounded-lg text-sm hover:bg-[#94371F]">
              ✕ {callState === 'calling' ? 'Cancel' : callState === 'failed' ? 'Close' : 'End Call'}
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
                <button onClick={() => startCall(activeChat, activeName)}
                  className="flex items-center gap-1 bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-full text-xs font-medium"
                  title={`Call ${activeName}`}>
                  📞 Call
                </button>
              )}
              <button onClick={toggleOpen} className="text-white/80 hover:text-white text-sm">✕</button>
            </div>
          </div>

          {teamError && (
            <div className="px-3 py-2 bg-[#F3E1DB] text-[#B3472F] text-xs shrink-0 flex items-center justify-between gap-2">
              <span>⚠️ {teamError}</span>
              <button onClick={loadTeam} className="underline shrink-0">Retry</button>
            </div>
          )}
          {messagesError && (
            <div className="px-3 py-2 bg-[#F3E1DB] text-[#B3472F] text-xs shrink-0 flex items-center justify-between gap-2">
              <span>⚠️ {messagesError}</span>
              <button onClick={load} className="underline shrink-0">Retry</button>
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
