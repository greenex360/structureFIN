import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const REMINDER_ROLES = ['Accounts Executive', 'Sr. Accounts Executive', 'Asst. Manager', 'Manager']

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const due = new Date(dateStr); due.setUTCHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL

  if (!supabaseUrl || !serviceKey || !resendApiKey || !fromEmail) {
    return NextResponse.json({ sent: 0, failed: 0, note: 'Email reminders are not configured' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const resend = new Resend(resendApiKey)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const { data: eligibleRoles } = await supabase
    .from('fin_user_roles')
    .select('user_id')
    .in('fin_role', REMINDER_ROLES)
    .eq('is_active', true)
  const eligibleUserIds = new Set((eligibleRoles ?? []).map((r: any) => r.user_id))

  const { data: instances, error } = await supabase
    .from('fin_activity_instances')
    .select(`
      id, activity_name, main_group, due_date, period_label, assigned_to,
      assignee:users!fin_activity_instances_assigned_to_fkey(email, name),
      activity_master:fin_activity_master(reminder_days_before)
    `)
    .neq('status', 'completed')
    .not('assigned_to', 'is', null)

  if (error) {
    return NextResponse.json({ error: `Could not load activities: ${error.message}` }, { status: 500 })
  }

  type DueItem = { activity_name: string; main_group: string; due_date: string; period_label: string | null; daysLeft: number }
  type LogEntry = { activity_instance_id: string; days_before: number }
  type Bucket = { email: string; name: string | null; items: DueItem[]; logEntries: LogEntry[] }
  const dueByAssignee = new Map<string, Bucket>()

  for (const row of (instances as any[]) ?? []) {
    const reminderDays = (row.activity_master?.reminder_days_before ?? '')
      .split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
    if (reminderDays.length === 0) continue

    const left = daysUntil(row.due_date)
    if (!reminderDays.includes(left)) continue
    if (!row.assignee?.email) continue
    if (!eligibleUserIds.has(row.assigned_to)) continue

    const { data: existing } = await supabase
      .from('fin_reminder_log')
      .select('id')
      .eq('activity_instance_id', row.id)
      .eq('days_before', left)
      .maybeSingle()
    if (existing) continue

    const key = row.assigned_to
    const bucket: Bucket = dueByAssignee.get(key) ?? { email: row.assignee.email, name: row.assignee.name, items: [], logEntries: [] }
    bucket.items.push({
      activity_name: row.activity_name,
      main_group: row.main_group,
      due_date: row.due_date,
      period_label: row.period_label,
      daysLeft: left,
    })
    bucket.logEntries.push({ activity_instance_id: row.id, days_before: left })
    dueByAssignee.set(key, bucket)
  }

  let sent = 0
  let failed = 0
  const errors: string[] = []
  const sentLogEntries: LogEntry[] = []

  for (const [, bucket] of dueByAssignee) {
    const rows = bucket.items
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map(i => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #EFF1EA;">${i.activity_name}${i.period_label ? ` <span style="color:#8A9389;">(${i.period_label})</span>` : ''}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #EFF1EA;">${i.main_group}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #EFF1EA;">${formatDate(i.due_date)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #EFF1EA;">${i.daysLeft === 0 ? 'Due today' : `${i.daysLeft}d left`}</td>
        </tr>`).join('')

    try {
      const result = await resend.emails.send({
        from: fromEmail,
        to: bucket.email,
        subject: `StructureFIN: ${bucket.items.length} activit${bucket.items.length === 1 ? 'y' : 'ies'} due soon`,
        html: `
          <p>Hi ${bucket.name ?? ''},</p>
          <p>The following activities are coming up:</p>
          <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
            <thead>
              <tr style="background:#EFF1EA;text-align:left;">
                <th style="padding:6px 10px;">Activity</th>
                <th style="padding:6px 10px;">Group</th>
                <th style="padding:6px 10px;">Due</th>
                <th style="padding:6px 10px;">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:16px;"><a href="${appUrl}/activities?scope=mine">View My Work</a></p>
        `,
      })
      if (result.error) {
        failed++
        errors.push(`${bucket.email}: ${result.error.message}`)
      } else {
        sent++
        sentLogEntries.push(...bucket.logEntries)
      }
    } catch (err: any) {
      failed++
      errors.push(`${bucket.email}: ${err.message ?? 'unknown error'}`)
    }
  }

  if (sentLogEntries.length > 0) {
    await supabase.from('fin_reminder_log').insert(sentLogEntries)
  }

  return NextResponse.json({ sent, failed, recipients: dueByAssignee.size, errors: errors.length ? errors : undefined })
}
