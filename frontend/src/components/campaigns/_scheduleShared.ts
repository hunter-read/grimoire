import { LuCheck, LuMinus, LuX } from 'react-icons/lu'

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const MONTH_WEEKS = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'Last' },
]

export const FREQ_OPTIONS = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Bi-weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom' },
]

export const AVAIL_OPTIONS = [
  { value: 'available', label: 'Available', Icon: LuCheck, color: 'var(--success)' },
  { value: 'tentative', label: 'Tentative', Icon: LuMinus, color: 'var(--gold)' },
  { value: 'unavailable', label: 'Unavailable', Icon: LuX, color: 'var(--danger)' },
]

export const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export function formatDate(dateStr) {
  if (!dateStr) return {}
  const d = new Date(dateStr + 'T00:00:00')
  return {
    short: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
  }
}

// Format a stored local "HH:MM" for display (e.g. "07:30 PM").
//
// Schedule times are stored in the zone they were picked in, so there is no
// conversion to do here — only formatting. The previous helpers converted to and
// from UTC, which is what dropped the day rollover: 19:30 local became 02:30 UTC
// while the weekday stayed put, so a Sunday game described Saturday evening.
export function formatScheduleTime(localHHMM) {
  if (!localHHMM) return null
  const [h, m] = localHHMM.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true })
}

export const inputStyle = {
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
}
export const submitBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
export const dangerBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 13,
}
export const addBtn = {
  padding: '8px 12px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
}
