import { supabase } from './supabase'
import { computeDueDatesForFY } from './dueDateEngine'

export const MAIN_GROUPS = [
  'GST', 'TDS / TCS', 'Income Tax', 'Payroll Statutory', 'MCA / ROC', 'Banking',
  'Loans & Borrowings', 'BG / LC / FD / Deposits', 'Credit Cards', 'Recurring Payments',
  'Daily Accounting', 'Reconciliations', 'Month-End Closing', 'Quarter-End Closing',
  'Year-End Closing', 'Statutory Audit', 'Tax Audit', 'Bank / Lender Audit',
  'Project Finance', 'EPC-Specific Finance', 'Insurance', 'Legal / Notice Tracker',
  'MIS', 'Budget & Forecast', 'Management Activities', 'Documentation',
  'System / ERP Controls', 'Certificates & Renewals', 'Special / Event-Based', 'Custom',
]

export const FREQUENCY_TYPES = [
  'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Half-Yearly', 'Annual', 'Event-Based', 'One-Time',
]

export const DUE_RULE_TYPES = [
  { value: 'fixed_day_of_month', label: 'Fixed day-of-month' },
  { value: 'fixed_date', label: 'Fixed calendar date' },
  { value: 'multiple_fixed_dates', label: 'Multiple fixed dates' },
  { value: 'manual', label: 'Manual / ad-hoc' },
]

export const FIN_ROLES = [
  'Admin', 'Accounts Executive', 'Sr. Accounts Executive', 'Asst. Manager', 'Manager', 'CFO', 'Managing Director',
]

export const STATUSES = ['not_started', 'in_progress', 'pending_review', 'completed']

export async function fetchActivityMaster() {
  const { data, error } = await supabase
    .from('fin_activity_master')
    .select('*')
    .order('main_group', { ascending: true })
  return { data: data ?? [], error }
}

export async function fetchActivityInstances(filters?: { assignedTo?: string; status?: string }) {
  let query = supabase
    .from('fin_activity_instances')
    .select(`
      *,
      company:companies(name),
      assignee:users!fin_activity_instances_assigned_to_fkey(id, name, email),
      reviewer:users!fin_activity_instances_reviewer_id_fkey(id, name, email)
    `)
    .order('due_date', { ascending: true })

  if (filters?.assignedTo) query = query.eq('assigned_to', filters.assignedTo)
  if (filters?.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  return { data: data ?? [], error }
}

export async function fetchCompanies() {
  const { data } = await supabase.from('companies').select('id, name').eq('is_active', true).order('name')
  return data ?? []
}

export async function fetchTeam() {
  const { data, error } = await supabase
    .from('fin_user_roles')
    .select('user_id, fin_role, is_active, user:users(id, name, email)')
    .order('fin_role')
  if (error) throw new Error(`Could not load team: ${error.message}`)
  return data ?? []
}

export async function fetchAllUsers() {
  const { data } = await supabase.from('users').select('id, name, email').order('name')
  return data ?? []
}

/** Distinct groups that actually have activities, with a live count each — used for sidebar navigation. */
export async function fetchGroupCounts() {
  const { data } = await supabase.from('fin_activity_instances').select('main_group').neq('status', 'completed')
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.main_group, (counts.get(row.main_group) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** Distinct groups that have at least one active template — used for Group Defaults config. */
export async function fetchTemplateGroups() {
  const { data } = await supabase.from('fin_activity_master').select('main_group').eq('is_active', true)
  return [...new Set((data ?? []).map((r: any) => r.main_group))].sort()
}

/** Per-group default owner, overriding the global Accounts-Executive fallback. */
export async function fetchGroupDefaults() {
  const { data } = await supabase
    .from('fin_group_defaults')
    .select('main_group, assigned_to, reviewer_id, assignee:users!fin_group_defaults_assigned_to_fkey(id, name), reviewer:users!fin_group_defaults_reviewer_id_fkey(id, name)')
  return data ?? []
}

/**
 * Applies a group default to activities that already exist (generation only
 * applies defaults going forward). Only touches not-yet-completed instances
 * so finished work isn't reassigned after the fact.
 */
export async function applyGroupDefaultToExisting(mainGroup: string, assignedTo: string | null, reviewerId: string | null) {
  const payload: any = {}
  if (assignedTo) payload.assigned_to = assignedTo
  if (reviewerId) payload.reviewer_id = reviewerId
  if (Object.keys(payload).length === 0) return { updated: 0 }
  const { data, error } = await supabase
    .from('fin_activity_instances')
    .update(payload)
    .eq('main_group', mainGroup)
    .neq('status', 'completed')
    .select('id')
  if (error) throw new Error(`Could not update existing activities: ${error.message}`)
  return { updated: data?.length ?? 0 }
}

export async function upsertGroupDefault(mainGroup: string, assignedTo: string | null, reviewerId: string | null) {
  const { data, error } = await supabase.from('fin_group_defaults').upsert(
    { main_group: mainGroup, assigned_to: assignedTo, reviewer_id: reviewerId, updated_at: new Date().toISOString() },
    { onConflict: 'main_group' }
  ).select()
  if (error) throw new Error(`Could not save group default: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Save was blocked (no rows written) — you may not have permission to edit group defaults.')
}

/**
 * Generates every instance an active Activity Master template implies for one
 * company across one FY, skipping anything already generated (same template +
 * company + due date). New instances default to that group's configured
 * owner (fin_group_defaults), falling back to whoever holds Accounts
 * Executive if the group has no override; a Manager can reassign anytime.
 */
export async function generateActivitiesForFY(companyId: string, fyStartYear: number, createdBy: string | null) {
  const { data: templates, error: templatesErr } = await supabase.from('fin_activity_master').select('*').eq('is_active', true)
  if (templatesErr) throw new Error(`Could not read Activity Master: ${templatesErr.message}`)
  const templatesFound = templates?.length ?? 0
  if (templatesFound === 0) {
    return { created: 0, templatesFound: 0, occurrencesComputed: 0, alreadyExisted: 0, skippedNoRule: 0 }
  }

  const team = await fetchTeam()
  const globalDefaultAssignee = team.find((t: any) => t.fin_role === 'Accounts Executive' && t.is_active)?.user_id ?? null
  const groupDefaults = await fetchGroupDefaults()
  const groupDefaultMap = new Map(groupDefaults.map((g: any) => [g.main_group, g]))

  const { data: existing, error: existingErr } = await supabase
    .from('fin_activity_instances')
    .select('activity_master_id, due_date')
    .eq('company_id', companyId)
  if (existingErr) throw new Error(`Could not read existing activities: ${existingErr.message}`)
  const existingKeys = new Set((existing ?? []).map((e: any) => `${e.activity_master_id}_${e.due_date}`))

  let occurrencesComputed = 0
  let alreadyExisted = 0
  let skippedNoRule = 0
  const toInsert: any[] = []
  for (const t of templates!) {
    const occurrences = computeDueDatesForFY(t.due_rule_type, t.due_rule_value, t.frequency_type, fyStartYear)
    if (occurrences.length === 0) { skippedNoRule++; continue }
    const groupDefault: any = groupDefaultMap.get(t.main_group)
    const assignedTo = groupDefault?.assigned_to ?? globalDefaultAssignee
    const reviewerId = groupDefault?.reviewer_id ?? null
    for (const { dueDate, periodLabel } of occurrences) {
      occurrencesComputed++
      const key = `${t.id}_${dueDate}`
      if (existingKeys.has(key)) { alreadyExisted++; continue }
      existingKeys.add(key)
      toInsert.push({
        activity_master_id: t.id,
        main_group: t.main_group,
        activity_name: t.activity_name,
        company_id: companyId,
        due_date: dueDate,
        period_label: periodLabel,
        assigned_to: assignedTo,
        reviewer_id: reviewerId,
        priority: 'medium',
        status: 'not_started',
        evidence_required: t.evidence_required,
        evidence_type: t.evidence_type,
        created_by: createdBy,
      })
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('fin_activity_instances').insert(toInsert)
    if (error) throw new Error(`Insert failed: ${error.message}`)
  }
  return { created: toInsert.length, templatesFound, occurrencesComputed, alreadyExisted, skippedNoRule }
}

export async function bulkUpdateStatus(ids: string[], status: string) {
  if (ids.length === 0) return
  const payload: any = { status }
  payload.completed_at = status === 'completed' ? new Date().toISOString() : null
  const { data, error } = await supabase.from('fin_activity_instances').update(payload).in('id', ids).select('id')
  if (error) throw new Error(`Bulk update failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Update was blocked (no rows written) — you may not have permission to update these activities.')
  if (data.length < ids.length) throw new Error(`Only ${data.length} of ${ids.length} activities were updated — the rest were blocked (permission issue).`)
}

export async function bulkChangeGroup(ids: string[], mainGroup: string) {
  if (ids.length === 0) return
  const { data, error } = await supabase.from('fin_activity_instances').update({ main_group: mainGroup }).in('id', ids).select('id')
  if (error) throw new Error(`Bulk group change failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Group change was blocked (no rows written) — you may not have permission to update these activities.')
  if (data.length < ids.length) throw new Error(`Only ${data.length} of ${ids.length} activities were updated — the rest were blocked (permission issue).`)
}

export async function bulkReassign(ids: string[], assignedTo: string) {
  if (ids.length === 0) return
  const { data, error } = await supabase.from('fin_activity_instances').update({ assigned_to: assignedTo }).in('id', ids).select('id')
  if (error) throw new Error(`Bulk reassign failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Reassign was blocked (no rows written) — you may not have permission to reassign these activities.')
  if (data.length < ids.length) throw new Error(`Only ${data.length} of ${ids.length} activities were reassigned — the rest were blocked (permission issue).`)
}

/** Moves every already-generated instance of a template (including completed ones) into its template's current group, so historical reporting stays consistent with the corrected category. */
export async function updateInstancesMainGroup(activityMasterId: string, mainGroup: string) {
  const { data, error } = await supabase
    .from('fin_activity_instances')
    .update({ main_group: mainGroup })
    .eq('activity_master_id', activityMasterId)
    .select('id')
  if (error) throw new Error(`Could not update existing activities' group: ${error.message}`)
  return { updated: data?.length ?? 0 }
}

export async function reassignOne(id: string, assignedTo: string | null, reviewerId: string | null) {
  const { data, error } = await supabase.from('fin_activity_instances').update({ assigned_to: assignedTo, reviewer_id: reviewerId }).eq('id', id).select('id')
  if (error) throw new Error(`Reassign failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error('Reassign was blocked (no rows written) — you may not have permission to reassign this activity.')
}
