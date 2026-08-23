import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

/**
 * Switch between the versions of one item.
 *
 * A book, map, token, or audio track can collapse several files into one entry —
 * a printer-friendly cut, a gridless map, an older version (issues #304, #306).
 * Only the main entry appears in listings; this is how the others are reached.
 *
 * Renders nothing when there is only one version, so callers can mount it
 * unconditionally rather than repeating the check at every call site.
 */
export default function VariantPicker({ item, detailPath, compact = false }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const siblings = item?.variants || []
  if (siblings.length === 0) return null

  // The family is (main entry + its variants); the main entry is not in
  // `variants`, so it is prepended here to make one flat list of choices.
  const mainId = item.variant_main_id || item.id
  const options = [
    { id: mainId, kind: '', label: '', isMain: true },
    ...siblings.map((v) => ({ ...v, isMain: false })),
  ]

  const optionLabel = (option) => {
    if (option.isMain) return t('variants.mainVersion')
    // A free-text label ("v1.0.1", "Gridded") is more specific than the kind,
    // so it wins when the user has set one.
    if (option.label) return option.label
    return t(`variants.kind.${option.kind}`, { defaultValue: option.kind })
  }

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: compact ? 12 : 13,
        color: 'var(--text-dim)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 8,
          color: 'var(--variant)',
          background: 'rgba(79,209,197,0.12)',
          border: '1px solid rgba(79,209,197,0.35)',
          fontWeight: 600,
        }}
      >
        {t('variants.badge', { count: options.length })}
      </span>
      <select
        aria-label={t('variants.switchLabel')}
        value={item.id}
        onChange={(e) => {
          const next = e.target.value
          if (next !== item.id) navigate(detailPath(next))
        }}
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: compact ? 12 : 13,
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  )
}
