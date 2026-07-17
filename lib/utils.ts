export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr); due.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    pending_review: 'Pending Review',
    completed: 'Completed',
  }
  return map[status] ?? status
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    not_started: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-[#F2E7D2] text-[#B4801F]',
    pending_review: 'bg-[#DEEAE4] text-[#17352B]',
    completed: 'bg-[#DEEAE4] text-[#2E6F5C]',
  }
  return map[status] ?? 'bg-gray-100 text-gray-600'
}

export function getPriorityColor(priority: string): string {
  const map: Record<string, string> = {
    high: 'bg-[#F3E1DB] text-[#B3472F]',
    medium: 'bg-[#F2E7D2] text-[#B4801F]',
    low: 'bg-gray-100 text-gray-500',
  }
  return map[priority] ?? 'bg-gray-100 text-gray-500'
}
