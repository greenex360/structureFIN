import { supabase } from './supabase'

export type ChatMessage = {
  id: string
  message: string
  created_at: string
  sender_id: string
  recipient_id: string | null
  sender: { id: string; name: string; email: string } | null
}

export async function fetchMessages(limit = 300): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('fin_messages')
    .select('id, message, created_at, sender_id, recipient_id, sender:users!fin_messages_sender_id_fkey(id, name, email)')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Could not load messages: ${error.message}`)
  return (data as any) ?? []
}

export async function sendMessage(senderId: string, message: string, recipientId: string | null = null) {
  const trimmed = message.trim()
  if (!trimmed) return
  const { data, error } = await supabase
    .from('fin_messages')
    .insert({ sender_id: senderId, message: trimmed, recipient_id: recipientId })
    .select('id')
  if (error) throw new Error(`Could not send message: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Message was blocked (no rows written) — you may not have permission to send this.')
}
