import { useTranslation } from 'react-i18next'

/**
 * Non-zero reference counts only — "0 bookmarks, 0 favorites" is noise, and
 * what matters when choosing which copy to keep is which one carries actual
 * user work.
 */
export default function RefCounts({ counts }) {
  const { t } = useTranslation()
  const text = Object.entries(counts || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${t(`maintenance.dupes.${k}`, { defaultValue: k })}`)
    .join(', ')
  if (!text) return null
  return <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>{text}</div>
}
