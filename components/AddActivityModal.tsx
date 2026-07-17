'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MAIN_GROUPS, fetchCompanies, fetchTeam } from '@/lib/finActivities'

export default function AddActivityModal({ templates, currentUserId, onClose, onSaved }: {
  templates: any[]
  currentUserId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [companies, setCompanies] = useState<any[]>([])
  const [team, setTeam] = useState<any[]>([])
  const [templateId, setTemplateId] = useState('')
  const [mainGroup, setMainGroup] = useState(MAIN_GROUPS[0])
  const [activityName, setActivityName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0])
  const [assignedTo, setAssignedTo] = useState('')
  const [reviewerId, setReviewerId] = useState('')
  const [priority, setPriority] = useState('medium')
  const [evidenceRequired, setEvidenceRequired] = useState(false)
  const [evidenceType, setEvidenceType] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchCompanies().then(setCompanies)
    fetchTeam().then(rows => {
      setTeam(rows)
      const defaultAE = rows.find((r: any) => r.fin_role === 'Accounts Executive')
      if (defaultAE) setAssignedTo(defaultAE.user_id)
    })
  }, [])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find(t => t.id === id)
    if (t) {
      setMainGroup(t.main_group)
      setActivityName(t.activity_name)
      setEvidenceRequired(t.evidence_required ?? false)
      setEvidenceType(t.evidence_type ?? '')
    }
  }

  async function handleSave() {
    if (!activityName) { alert('Activity name is required'); return }
    if (!assignedTo) { alert('Assign this to someone'); return }
    setSaving(true)
    const { error } = await supabase.from('fin_activity_instances').insert({
      activity_master_id: templateId || null,
      main_group: mainGroup,
      activity_name: activityName,
      company_id: companyId || null,
      due_date: dueDate,
      assigned_to: assignedTo,
      reviewer_id: reviewerId || null,
      priority,
      status: 'not_started',
      evidence_required: evidenceRequired,
      evidence_type: evidenceType || null,
      comments: notes || null,
      created_by: currentUserId,
    })
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-[#1C2320]">Add Activity</h2>

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">From template (optional)</label>
          <select value={templateId} onChange={e => applyTemplate(e.target.value)}
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
            <option value="">— Custom activity —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.main_group} · {t.activity_name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Main Group *</label>
            <select value={mainGroup} onChange={e => setMainGroup(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
              {MAIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Activity Name *</label>
            <input value={activityName} onChange={e => setActivityName(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Company</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Due Date *</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Assigned To *</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
              <option value="">Select</option>
              {team.map((t: any) => (
                <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Reviewer</label>
            <select value={reviewerId} onChange={e => setReviewerId(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {team.map((t: any) => (
                <option key={t.user_id} value={t.user_id}>{t.user?.name} · {t.fin_role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="ev" checked={evidenceRequired} onChange={e => setEvidenceRequired(e.target.checked)} />
            <label htmlFor="ev" className="text-sm text-[#1C2320]">Evidence required</label>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
        </div>

        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
            {saving ? 'Saving...' : 'Save Activity'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-[#D7DCD1] text-[#5B665D] rounded-lg text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
