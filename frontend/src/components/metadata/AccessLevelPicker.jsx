import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { ACCESS_ADMIN, ACCESS_GM, ACCESS_INHERIT, ACCESS_OPEN } from '../../accessLevels'

// Who may see this book or system (issue #258). Admin-only: the backend rejects
// the write from anyone else, so the control is hidden rather than shown
// disabled — a GM has no use for a picker they cannot submit.
//
// `allowInherit` distinguishes the two callers. A book gets four options,
// because "inherit from my system/category" and "explicitly open" are different
// states: the second overrides a restricted system, the first does not. A
// system sits at the top of the cascade and so has nothing to inherit from.
export default function AccessLevelPicker({
  value,
  onChange,
  allowInherit = true,
  effectiveLevel = null,
  id = 'access-level',
}) {
  const { t } = useTranslation()
  // useAuth returns null outside an AuthProvider (some editors are rendered in
  // isolation, and every test harness does). Treating that as "not an admin" is
  // both the safe default and the one that keeps those call sites working.
  const auth = useAuth()
  if (auth?.user?.role !== 'admin') return null

  const current = value === null || value === undefined ? ACCESS_INHERIT : value
  // Only worth explaining what "inherit" resolved to; the other options say what
  // they do on their own.
  const showResolved = allowInherit && current === ACCESS_INHERIT && effectiveLevel

  return (
    <div>
      <label htmlFor={id} style={label}>
        {t('access.pickerLabel')}
      </label>
      <select id={id} value={current} onChange={(e) => onChange(e.target.value)} style={select}>
        {allowInherit && <option value={ACCESS_INHERIT}>{t('access.levels.inherit')}</option>}
        <option value={ACCESS_OPEN}>{t('access.levels.open')}</option>
        <option value={ACCESS_GM}>{t('access.levels.gm')}</option>
        <option value={ACCESS_ADMIN}>{t('access.levels.admin')}</option>
      </select>
      {showResolved && (
        <p style={hint}>
          {t('access.inheritedAs', { level: t(`access.levels.${effectiveLevel || 'open'}`) })}
        </p>
      )}
    </div>
  )
}

const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const select = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 14,
}
const hint = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
  lineHeight: 1.5,
}
