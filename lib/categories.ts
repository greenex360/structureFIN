// Umbrella categories group the 29 fine-grained Main Groups into a handful of
// colored tiles for the dashboard — the sidebar still shows raw groups for
// precise filtering, this is the "zoomed out" view.

export type UmbrellaCategory = {
  key: string
  label: string
  icon: string
  color: string
  groups: string[]
  description: string
}

export const UMBRELLA_CATEGORIES: UmbrellaCategory[] = [
  {
    key: 'statutory-tax',
    label: 'Statutory & Tax',
    icon: '🧾',
    color: '#2E6F5C',
    groups: ['GST', 'TDS / TCS', 'Income Tax', 'Payroll Statutory'],
    description: 'GST, TDS, PF, ESI, IT & More',
  },
  {
    key: 'mca-secretarial',
    label: 'MCA & Secretarial',
    icon: '📜',
    color: '#6D5BA8',
    groups: ['MCA / ROC'],
    description: 'ROC Filings, KYC & More',
  },
  {
    key: 'banking-treasury',
    label: 'Banking & Treasury',
    icon: '🏦',
    color: '#2B6CB0',
    groups: ['Banking', 'Loans & Borrowings', 'BG / LC / FD / Deposits'],
    description: 'Bank A/c, BG, Loans, FD & More',
  },
  {
    key: 'cards-payments',
    label: 'Cards & Payments',
    icon: '💳',
    color: '#C2437A',
    groups: ['Credit Cards', 'Recurring Payments'],
    description: 'Cards, EMI, Rent, Subscriptions',
  },
  {
    key: 'accounting-ops',
    label: 'Accounting Operations',
    icon: '📊',
    color: '#3F9142',
    groups: ['Daily Accounting', 'Reconciliations', 'Month-End Closing', 'Quarter-End Closing', 'Year-End Closing'],
    description: 'Vouchers, Reconciliation, Closing',
  },
  {
    key: 'audit-control',
    label: 'Audit & Control',
    icon: '🛡️',
    color: '#B4801F',
    groups: ['Statutory Audit', 'Tax Audit', 'Bank / Lender Audit', 'Legal / Notice Tracker'],
    description: 'Statutory Audit, Tax Audit & More',
  },
  {
    key: 'project-epc',
    label: 'Project & EPC',
    icon: '🏗️',
    color: '#C2540E',
    groups: ['Project Finance', 'EPC-Specific Finance'],
    description: 'Project Budgets, RA Bills, WIP',
  },
  {
    key: 'mis-reporting',
    label: 'MIS & Reporting',
    icon: '📈',
    color: '#1B8FA8',
    groups: ['MIS', 'Budget & Forecast', 'Management Activities'],
    description: 'Cash Flow, P&L, MIS Reports',
  },
  {
    key: 'documents-admin',
    label: 'Documents & Admin',
    icon: '📁',
    color: '#6B7280',
    groups: ['Documentation', 'System / ERP Controls', 'Certificates & Renewals', 'Special / Event-Based', 'Insurance', 'Custom'],
    description: 'Policies, Certificates & More',
  },
]

export function umbrellaForGroup(group: string): UmbrellaCategory | undefined {
  return UMBRELLA_CATEGORIES.find(u => u.groups.includes(group))
}
