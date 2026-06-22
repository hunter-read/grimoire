// Convert UTC hour+minute to a local "HH:MM" string for display.
export function utcToLocalTime(utcHour, utcMinute) {
  const d = new Date()
  d.setUTCHours(utcHour, utcMinute, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Parse a local "HH:MM" string and return { hour, minute } in UTC.
export function localTimeToUtc(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
