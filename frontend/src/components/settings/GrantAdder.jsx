import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCESS_ADMIN, ACCESS_GM } from '../../accessLevels'
import { ghostBtnStyle } from './settingsButtons'

// One "pick a target, pick a level, add" row of the access-grants panel. Its
// own file because eslint's react/no-multi-comp is an error here, with
// ignoreStateless off — one component per file, no exceptions outside tests.
export default function GrantAdder({ label, options, onAdd, disabled }) {
  const { t } = useTranslation()
  const [target, setTarget] = useState('')
  const [level, setLevel] = useState(ACCESS_GM)

  if (options.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        style={selectStyle}
        aria-label={label}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value)}
        style={{ ...selectStyle, minWidth: 140 }}
        aria-label={t('access.grants.levelLabel')}
      >
        <option value={ACCESS_GM}>{t('access.levels.gm')}</option>
        <option value={ACCESS_ADMIN}>{t('access.levels.admin')}</option>
      </select>
      <button
        type="button"
        onClick={() => {
          onAdd(target, level)
          setTarget('')
        }}
        disabled={disabled || !target}
        style={ghostBtnStyle}
      >
        +
      </button>
    </div>
  )
}

const selectStyle = {
  padding: '6px 8px',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  flex: 1,
  minWidth: 0,
}
