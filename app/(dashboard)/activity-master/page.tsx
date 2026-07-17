'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MAIN_GROUPS, FREQUENCY_TYPES, DUE_RULE_TYPES, fetchActivityMaster, updateInstancesMainGroup } from '@/lib/finActivities'

const emptyForm = () => ({
  id: null as string | null,
  main_group: MAIN_GROUPS[0],
  subgroup: '',
  activity_name: '',
  checklist: '',
  frequency_type: 'Monthly',
  due_rule_type: 'fixed_day_of_month',
  due_rule_value: '',
  reminder_days_before: '7,3,1',
  evidence_required: true,
  evidence_type: '',
  is_active: true,
})

export default function ActivityMasterPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [originalMainGroup, setOriginalMainGroup] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [groupFilter, setGroupFilter] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await fetchActivityMaster()
    setRows(data)
    setLoading(false)
  }

  function openNew() {
    setForm(emptyForm())
    setOriginalMainGroup(null)
    setShowForm(true)
  }

  function openEdit(row: any) {
    setOriginalMainGroup(row.main_group)
    setForm({
      id: row.id,
      main_group: row.main_group,
      subgroup: row.subgroup ?? '',
      activity_name: row.activity_name,
      checklist: row.checklist ?? '',
      frequency_type: row.frequency_type,
      due_rule_type: row.due_rule_type,
      due_rule_value: row.due_rule_value ?? '',
      reminder_days_before: row.reminder_days_before ?? '',
      evidence_required: row.evidence_required ?? false,
      evidence_type: row.evidence_type ?? '',
      is_active: row.is_active ?? true,
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.activity_name) { alert('Activity name is required'); return }
    setSaving(true)
    const payload = {
      main_group: form.main_group,
      subgroup: form.subgroup || null,
      activity_name: form.activity_name,
      checklist: form.checklist || null,
      frequency_type: form.frequency_type,
      due_rule_type: form.due_rule_type,
      due_rule_value: form.due_rule_value || null,
      reminder_days_before: form.reminder_days_before || null,
      evidence_required: form.evidence_required,
      evidence_type: form.evidence_type || null,
      is_active: form.is_active,
    }
    const { data, error } = form.id
      ? await supabase.from('fin_activity_master').update(payload).eq('id', form.id).select('id')
      : await supabase.from('fin_activity_master').insert(payload).select('id')
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    if (!data || data.length === 0) { alert('Save was blocked (no rows written) — you may not have permission to edit the Activity Master.'); return }

    if (form.id && originalMainGroup && form.main_group !== originalMainGroup) {
      const moveExisting = confirm(
        `Group changed from "${originalMainGroup}" to "${form.main_group}". Also move already-generated activities for this template into "${form.main_group}"?`
      )
      if (moveExisting) {
        try {
          const { updated } = await updateInstancesMainGroup(form.id, form.main_group)
          alert(`Moved ${updated} existing activit${updated === 1 ? 'y' : 'ies'} to "${form.main_group}".`)
        } catch (err: any) {
          alert('Error: ' + err.message)
        }
      }
    }

    setShowForm(false)
    load()
  }

  const dueRulePlaceholder: Record<string, string> = {
    fixed_day_of_month: 'DD or DD+N — e.g. 20  or  7+1 (7th, month after)',
    fixed_date: 'DD-MM — e.g. 30-09',
    multiple_fixed_dates: 'DD-MM,DD-MM,... — e.g. 15-06,15-09,15-12,15-03',
    manual: 'Set per instance — leave blank',
  }

  const filtered = groupFilter ? rows.filter(r => r.main_group === groupFilter) : rows

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1C2320]">Activity Master</h1>
          <p className="text-sm text-[#5B665D] mt-1">The template library every activity gets created from.</p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
          + Add Activity Template
        </button>
      </div>

      <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
        className="border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">All groups</option>
        {MAIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
      </select>

      {showForm && (
        <div className="bg-white border border-[#2E6F5C] rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-[#1C2320]">{form.id ? 'Edit Template' : 'New Activity Template'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Main Group *</label>
              <select value={form.main_group} onChange={e => setForm({ ...form, main_group: e.target.value })}
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
                {MAIN_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Subgroup</label>
              <input value={form.subgroup} onChange={e => setForm({ ...form, subgroup: e.target.value })}
                placeholder="e.g. Returns & Filing"
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Activity Name *</label>
              <input value={form.activity_name} onChange={e => setForm({ ...form, activity_name: e.target.value })}
                placeholder="e.g. GSTR-3B Filing"
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Frequency</label>
              <select value={form.frequency_type} onChange={e => setForm({ ...form, frequency_type: e.target.value })}
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
                {FREQUENCY_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Due Rule Type</label>
              <select value={form.due_rule_type} onChange={e => setForm({ ...form, due_rule_type: e.target.value })}
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
                {DUE_RULE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Due Rule Value</label>
              <input value={form.due_rule_value} onChange={e => setForm({ ...form, due_rule_value: e.target.value })}
                placeholder={dueRulePlaceholder[form.due_rule_type]}
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5B665D] mb-1">Reminder Days Before</label>
              <input value={form.reminder_days_before} onChange={e => setForm({ ...form, reminder_days_before: e.target.value })}
                placeholder="7,3,1"
                className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="evreq" checked={form.evidence_required}
                onChange={e => setForm({ ...form, evidence_required: e.target.checked })} />
              <label htmlFor="evreq" className="text-sm text-[#1C2320]">Evidence required</label>
            </div>
            {form.evidence_required && (
              <div>
                <label className="block text-xs font-medium text-[#5B665D] mb-1">Evidence type</label>
                <input value={form.evidence_type} onChange={e => setForm({ ...form, evidence_type: e.target.value })}
                  placeholder="e.g. Filed return ARN copy"
                  className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#5B665D] mb-1">Checklist</label>
            <textarea value={form.checklist} onChange={e => setForm({ ...form, checklist: e.target.value })}
              rows={2} placeholder="Reconcile 2B → compute liability → pay → file"
              className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
              {saving ? 'Saving...' : 'Save Template'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-[#D7DCD1] text-[#5B665D] rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-[#D7DCD1] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#EFF1EA] text-[#5B665D] text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Activity</th>
              <th className="px-4 py-3 text-left">Group / Subgroup</th>
              <th className="px-4 py-3 text-left">Frequency</th>
              <th className="px-4 py-3 text-left">Due Rule</th>
              <th className="px-4 py-3 text-center">Evidence</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-[#8A9389]">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-[#8A9389]">No templates yet — add your first one above</td></tr>
            ) : (
              filtered.map(row => (
                <tr key={row.id} onClick={() => openEdit(row)} className="border-t border-[#EFF1EA] hover:bg-[#EFF1EA] cursor-pointer">
                  <td className="px-4 py-3 font-medium text-[#1C2320]">{row.activity_name}</td>
                  <td className="px-4 py-3 text-[#5B665D]">{row.main_group}{row.subgroup ? ` · ${row.subgroup}` : ''}</td>
                  <td className="px-4 py-3 text-[#5B665D]">{row.frequency_type}</td>
                  <td className="px-4 py-3 text-[#5B665D]">{row.due_rule_value || '—'}</td>
                  <td className="px-4 py-3 text-center">{row.evidence_required ? '✅' : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.is_active ? 'bg-[#DEEAE4] text-[#2E6F5C]' : 'bg-gray-100 text-gray-500'}`}>
                      {row.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
