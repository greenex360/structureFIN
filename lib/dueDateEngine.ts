// Due Rule Value mini-syntax:
//   fixed_day_of_month     "DD"        e.g. "20"        -> 20th of the activity's own month
//                          "DD+N"      e.g. "7+1"       -> 7th of the month N months after the activity's month
//   fixed_date             "DD-MM"     e.g. "30-09"     -> 30 September every FY, once a year
//   multiple_fixed_dates   "DD-MM,DD-MM,..."             -> one instance per date, every FY (labeled Q1..Q4 if there are 4)
//   manual                 (empty)     -> not auto-generated, created by hand via Add Activity

export type DueOccurrence = { dueDate: string; periodLabel: string }

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number) { return String(n).padStart(2, '0') }
function ymd(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}` }
function fyLabel(fyStartYear: number) { return `FY ${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}` }

function addMonths(year: number, month: number, offset: number) {
  let y = year, m = month + offset
  while (m > 12) { m -= 12; y++ }
  while (m < 1) { m += 12; y-- }
  return { y, m }
}

/** FY runs Apr(year) -> Mar(year+1). Returns [{y, m}] for all 12 months in order. */
export function fyMonths(fyStartYear: number): { y: number; m: number }[] {
  const months: { y: number; m: number }[] = []
  for (let i = 0; i < 12; i++) months.push(addMonths(fyStartYear, 4, i))
  return months
}

/** Given a template's rule + frequency, return every (due date, period label) that belongs in the given FY. */
export function computeDueDatesForFY(
  dueRuleType: string,
  dueRuleValue: string | null,
  frequencyType: string,
  fyStartYear: number
): DueOccurrence[] {
  if (!dueRuleValue) return []

  if (dueRuleType === 'fixed_day_of_month' && frequencyType === 'Monthly') {
    const [dayStr, offsetStr] = dueRuleValue.split('+')
    const day = parseInt(dayStr, 10)
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0
    if (!day) return []
    return fyMonths(fyStartYear).map(({ y, m }) => {
      const target = addMonths(y, m, offset)
      return { dueDate: ymd(target.y, target.m, day), periodLabel: `${MONTH_NAMES[m - 1]} ${y}` }
    })
  }

  if (dueRuleType === 'fixed_date') {
    const [dayStr, monthStr] = dueRuleValue.split('-')
    const day = parseInt(dayStr, 10)
    const month = parseInt(monthStr, 10)
    if (!day || !month) return []
    const y = month >= 4 ? fyStartYear : fyStartYear + 1
    return [{ dueDate: ymd(y, month, day), periodLabel: fyLabel(fyStartYear) }]
  }

  if (dueRuleType === 'multiple_fixed_dates') {
    const pairs = dueRuleValue.split(',').map(p => p.trim()).filter(Boolean)
    const useQuarterLabels = pairs.length === 4
    return pairs.map((pair, i) => {
      const [dayStr, monthStr] = pair.split('-')
      const day = parseInt(dayStr, 10)
      const month = parseInt(monthStr, 10)
      const y = month >= 4 ? fyStartYear : fyStartYear + 1
      const periodLabel = useQuarterLabels ? `Q${i + 1} ${fyLabel(fyStartYear)}` : fyLabel(fyStartYear)
      return { dueDate: ymd(y, month, day), periodLabel }
    })
  }

  return []
}

export function currentFYStartYear(): number {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  return m >= 4 ? y : y - 1
}

export function fyStartYearForDate(dateStr: string): number {
  const y = Number(dateStr.slice(0, 4))
  const m = Number(dateStr.slice(5, 7))
  return m >= 4 ? y : y - 1
}

export function fyLabelForDate(dateStr: string): string {
  return fyLabel(fyStartYearForDate(dateStr))
}
