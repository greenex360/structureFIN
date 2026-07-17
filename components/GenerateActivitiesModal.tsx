'use client'

import { useEffect, useState } from 'react'
import { fetchCompanies, generateActivitiesForFY } from '@/lib/finActivities'
import { currentFYStartYear } from '@/lib/dueDateEngine'

export default function GenerateActivitiesModal({ currentUserId, onClose, onGenerated }: {
  currentUserId: string | null
  onClose: () => void
  onGenerated: () => void
}) {
  const [companies, setCompanies] = useState<any[]>([])
  const [companyId, setCompanyId] = useState('')
  const [fyStartYear, setFyStartYear] = useState(currentFYStartYear())
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ created: number; templatesFound: number; occurrencesComputed: number; alreadyExisted: number; skippedNoRule: number } | null>(null)

  useEffect(() => {
    fetchCompanies().then(rows => {
      setCompanies(rows)
      if (rows.length === 1) setCompanyId(rows[0].id)
    })
  }, [])

  async function handleGenerate() {
    if (!companyId) { alert('Select a company'); return }
    setRunning(true)
    try {
      const res = await generateActivitiesForFY(companyId, fyStartYear, currentUserId)
      setResult(res)
      onGenerated()
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setRunning(false)
    }
  }

  const fyOptions = [0, -1, 1].map(o => currentFYStartYear() + o).sort((a, b) => a - b)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold text-[#1C2320]">Generate Activities</h2>
          <p className="text-xs text-[#5B665D] mt-1">
            Creates every instance the active Activity Master templates imply for one company across a
            financial year — monthly, annual, and multi-date rules all at once. Already-generated dates are skipped, so this is safe to run again.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">Company *</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)}
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
            <option value="">Select</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#5B665D] mb-1">Financial Year</label>
          <select value={fyStartYear} onChange={e => setFyStartYear(Number(e.target.value))}
            className="w-full border border-[#D7DCD1] rounded-lg px-3 py-2 text-sm">
            {fyOptions.map(y => <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>)}
          </select>
        </div>

        {result && (
          <div className={`rounded-lg px-4 py-3 text-sm space-y-1 ${result.created > 0 ? 'bg-[#DEEAE4] text-[#17352B]' : 'bg-[#F2E7D2] text-[#7A5A14]'}`}>
            <div className="font-medium">
              {result.created > 0
                ? `Done — ${result.created} activit${result.created === 1 ? 'y' : 'ies'} created.`
                : 'Nothing created — here\'s why:'}
            </div>
            <div className="text-xs space-y-0.5 opacity-90">
              <div>Active templates found in Activity Master: <strong>{result.templatesFound}</strong></div>
              {result.templatesFound > 0 && (
                <>
                  <div>Templates with no usable due rule (skipped): <strong>{result.skippedNoRule}</strong></div>
                  <div>Occurrences computed for this FY: <strong>{result.occurrencesComputed}</strong></div>
                  <div>Already existed (skipped, not duplicated): <strong>{result.alreadyExisted}</strong></div>
                </>
              )}
            </div>
            {result.templatesFound === 0 && (
              <p className="text-xs mt-1">
                Activity Master has no active templates for this company to generate from — go seed it first.
              </p>
            )}
            {result.templatesFound > 0 && result.skippedNoRule === result.templatesFound && (
              <p className="text-xs mt-1">
                Every template was skipped — their Due Rule Type/Value didn't parse. Check Activity Master:
                Due Rule Value should look like <code>20</code>, <code>7+1</code>, <code>30-09</code>, or <code>15-06,15-09,15-12,15-03</code>.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={handleGenerate} disabled={running}
            className="flex-1 px-4 py-2 bg-[#2E6F5C] text-white rounded-lg text-sm hover:bg-[#255A4A]">
            {running ? 'Generating...' : 'Generate'}
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-[#D7DCD1] text-[#5B665D] rounded-lg text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
