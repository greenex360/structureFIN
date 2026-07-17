'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getStatusLabel, formatDate } from '@/lib/utils'
import { STATUSES, MAIN_GROUPS, fetchTeam } from '@/lib/finActivities'

export default function InstantUpdateModal({ instance, onClose, onSaved }: {
  instance: any
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState(instance.status)
  const [comment, setComment] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const [showReassign, setShowReassign] = useState(false)
  const [team, setTeam] = useState<any[]>([])
  const [assignedTo, setAssignedTo] = useState(instance.assigned_to ?? '')
  const [reviewerId, setReviewerId] = useState(instance.reviewer_id ?? '')

  const [showChangeGroup, setShowChangeGroup] = useState(false)
  const [mainGroup, setMainGroup] = useState(instance.main_group ?? '')

  useEffect(() => {
    if (showReassign && team.length === 0) fetchTeam().then(setTeam)
  }, [showReassign])

  async function handleSave() {
    setSaving(true)
    try {
      let evidenceUrl = instance.evidence_url ?? null

      if (file) {
        const path = `${instance.id}/${Date.now()}_${file.name}`
        const { error: uploadErr } = await supabase.storage
          .from('structurefin-evidence')
          .upload(path, file, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('structurefin-evidence').getPublicUrl(path)
        evidenceUrl = urlData.publicUrl
      }

      const payload: any = {
        status,
        evidence_url: evidenceUrl,
        assigned_to: assignedTo || null,
        reviewer_id: reviewerId || null,
        main_group: mainGroup || instance.main_group,
      }
      if (comment) {
        payload.comments = instance.comments ? `${instance.comments}\n---\n${comment}` : comment
      }
      if (status === 'completed' && instance.status !== 'completed') {
        payload.completed_at = new Date().toISOString()
      }
      if (status !== 'completed') {
        payload.completed_at = null
      }

      const { data, error } = await supabase.from('fin_activity_instances').update(payload).eq('id', instance.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Save was blocked (no rows written) — you may not have permission to update this activity.')
      onSaved()
      onClose()
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold text-[#1C2320]">
            {instance.activity_name}{instance.period_label ? ` — ${instance.period_label}` : ''}
          </h2>
          <p className="text-xs text-[#5B665D] mt-1">
            {instance.company?.name ?? 'No company'} · Due {formatDate(instance.due_date)} · Assigned to {instance.assignee?.name ?? '—'} · Group: {mainGroup || instance.main_group}
            {!showReassign && (
              <button onClick={() => setShowReassign(true)} className="ml-2 text-[#2E6F5C] underline">Reassign</button>
            )}
            {!showChangeGroup && (
              <button onClick={() => setShowChangeGroup(true)} className="ml-2 text-[#2E6F5C] underline">Change Group</button>
            )}
          </p>
        </div>

        {showChangeGroup && (
          <div className="bg-[#F5F6F1] rounded-lg p-3">
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Group</label>
            <select value={mainGroup} onChange={e => setMainGroup(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-2 py-1.5 text-sm bg-white">
              {MAIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}

        {showReassign && (
          <div className="grid grid-cols-2 gap-3 bg-[#F5F6F1] rounded-lg p-3">
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Assigned To</label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
                className="w-full border border-[#D7DCD1] rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">—</option>
                {team.map((t: any) => <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Reviewer</label>
              <select value={reviewerId} onChange={e => setReviewerId(e.target.value)}
                className="w-full border border-[#D7DCD1] rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">—</option>
                {team.map((t: any) => <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{getStatusLabel(s)}</option>)}
          </select>
        </div>

        {(instance.evidence_required || file) && (
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">
              Evidence {instance.evidence_type ? `— ${instance.evidence_type}` : ''}
            </label>
            <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm" />
            {instance.evidence_url && !file && (
              <a href={instance.evidence_url} target="_blank" rel="noreferrer" className="text-xs text-[#2E6F5C] underline mt-1 inline-block">
                View current evidence
              </a>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">Comment</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder="Optional note..."
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-[#D7DCD1] text-[#5B665D] rounded-lg text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
