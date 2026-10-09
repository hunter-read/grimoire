import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuLock, LuUpload, LuTrash2 } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import OidcLoginButton from '../OidcLoginButton'
import Spinner from '../Spinner'

const COLOR_FIELDS = [
  ['oidc_button_bg_color', 'buttonBgColor'],
  ['oidc_button_text_color', 'buttonTextColor'],
  ['oidc_button_border_color', 'buttonBorderColor'],
]
const STYLE_FIELDS = [...COLOR_FIELDS.map(([key]) => key), 'oidc_button_radius']
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg'

// <input type="color"> only understands #rrggbb, so map the shorter and
// alpha forms onto it; the text box beside it keeps the exact value.
const toPickerValue = (v) => {
  if (!HEX_COLOR_RE.test(v || '')) return '#000000'
  const hex = v.slice(1)
  if (hex.length <= 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  return `#${hex.slice(0, 6)}`
}

const isValid = (key, v) => {
  if (v === '') return true
  if (key === 'oidc_button_radius') return /^\d+$/.test(v) && Number(v) <= 40
  return HEX_COLOR_RE.test(v)
}

/**
 * Admin editor for the OIDC sign-in button's look (issue #377): colors, corner
 * radius and an icon, with a live preview. Provider-agnostic on purpose - the
 * admin copies whatever their IdP's branding guidelines call for.
 */
export default function OIDCButtonAppearance({ data, label, onSaved }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState({})
  const [savingField, setSavingField] = useState(null)
  const [savedField, setSavedField] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    const next = {}
    for (const k of STYLE_FIELDS) next[k] = data[k] ?? ''
    setDraft(next)
  }, [data])

  const isLocked = (key) => !!data[`${key}_env_locked`]

  const run = async (key, request) => {
    setSavingField(key)
    setError('')
    try {
      onSaved(await request())
      setSavedField(key)
      setTimeout(() => setSavedField(null), 1800)
    } catch (e) {
      setError(e?.message || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const commit = (key) => {
    const v = (draft[key] ?? '').trim()
    if (isLocked(key) || v === (data[key] ?? '')) return
    if (!isValid(key, v)) {
      setError(
        key === 'oidc_button_radius'
          ? t('authSettings.oidc.buttonInvalidRadius')
          : t('authSettings.oidc.buttonInvalidColor')
      )
      return
    }
    run(key, () => settingsApi.patch({ [key]: v }))
  }

  const handleIconPick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) run('oidc_button_icon', () => settingsApi.uploadOidcButtonIcon(file))
  }

  const status = (key) => (
    <>
      {isLocked(key) && (
        <span style={lockedTagStyle} title={t('authSettings.oidc.envLockedTitle')}>
          <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
        </span>
      )}
      {savingField === key && <Spinner size={12} />}
      {savedField === key && <LuCircleCheck size={13} style={{ color: 'var(--green)' }} />}
    </>
  )

  const textInputProps = (key) => ({
    id: key,
    type: 'text',
    value: draft[key] ?? '',
    disabled: isLocked(key),
    onChange: (e) => setDraft((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => commit(key),
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.target.blur()
      }
    },
    style: { ...inputStyle, ...(isLocked(key) && lockedInputStyle) },
  })

  const iconLocked = isLocked('oidc_button_icon')
  const hasIcon = !!data.oidc_button_icon_url

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {t('authSettings.oidc.buttonAppearance')}
      </div>
      <div style={{ ...hintStyle, marginTop: 0, marginBottom: 12 }}>
        {t('authSettings.oidc.buttonAppearanceHint')}
      </div>

      <div style={previewStyle} aria-label={t('authSettings.oidc.buttonPreview')} role="group">
        <OidcLoginButton
          label={label || t('login.oidcDefault')}
          bgColor={draft.oidc_button_bg_color}
          textColor={draft.oidc_button_text_color}
          borderColor={draft.oidc_button_border_color}
          radius={draft.oidc_button_radius}
          iconUrl={data.oidc_button_icon_url}
        />
      </div>

      <div style={gridStyle}>
        {COLOR_FIELDS.map(([key, labelKey]) => (
          <div key={key}>
            <label htmlFor={key} style={fieldLabelStyle}>
              <span>{t(`authSettings.oidc.${labelKey}`)}</span>
              {status(key)}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="color"
                aria-label={t('authSettings.oidc.buttonColorPicker', {
                  field: t(`authSettings.oidc.${labelKey}`),
                })}
                value={toPickerValue(draft[key])}
                disabled={isLocked(key)}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                onBlur={() => commit(key)}
                style={swatchStyle}
              />
              <input
                {...textInputProps(key)}
                placeholder={t('authSettings.oidc.buttonColorPlaceholder')}
              />
            </div>
          </div>
        ))}
        <div>
          <label htmlFor="oidc_button_radius" style={fieldLabelStyle}>
            <span>{t('authSettings.oidc.buttonRadius')}</span>
            {status('oidc_button_radius')}
          </label>
          <input {...textInputProps('oidc_button_radius')} inputMode="numeric" placeholder="8" />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={fieldLabelStyle}>
          <span>{t('authSettings.oidc.buttonIcon')}</span>
          {status('oidc_button_icon')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept={ICON_ACCEPT}
            onChange={handleIconPick}
            style={{ display: 'none' }}
            data-testid="oidc-button-icon-input"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={iconLocked || savingField === 'oidc_button_icon'}
            style={{ ...secondaryBtnStyle, ...(iconLocked && disabledBtnStyle) }}
          >
            <LuUpload size={13} />
            {hasIcon
              ? t('authSettings.oidc.buttonIconReplace')
              : t('authSettings.oidc.buttonIconUpload')}
          </button>
          {hasIcon && !iconLocked && (
            <button
              type="button"
              onClick={() => run('oidc_button_icon', settingsApi.deleteOidcButtonIcon)}
              disabled={savingField === 'oidc_button_icon'}
              style={dangerBtnStyle}
            >
              <LuTrash2 size={13} />
              {t('authSettings.oidc.buttonIconRemove')}
            </button>
          )}
        </div>
        <div style={hintStyle}>{t('authSettings.oidc.buttonIconHint')}</div>
      </div>

      {error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

const panelStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 14,
  marginBottom: 14,
}

const previewStyle = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
  maxWidth: 360,
  marginBottom: 14,
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 12,
}

const fieldLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text-dim)',
  marginBottom: 5,
}

const hintStyle = { fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }

const inputStyle = {
  flex: 1,
  minWidth: 0,
  width: '100%',
  fontSize: 13,
  padding: '7px 10px',
  boxSizing: 'border-box',
  background: 'var(--bg-input)',
  color: 'var(--text)',
}

const lockedInputStyle = {
  background: 'var(--bg-deep)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed',
}

const swatchStyle = {
  width: 34,
  height: 32,
  padding: 2,
  flexShrink: 0,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-input)',
  cursor: 'pointer',
}

const lockedTagStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(180, 160, 100, 0.12)',
  color: 'var(--gold-dim)',
  border: '1px solid rgba(180, 160, 100, 0.4)',
}

const secondaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
}

const disabledBtnStyle = { opacity: 0.6, cursor: 'not-allowed' }

const dangerBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'rgba(180,60,60,0.12)',
  border: '1px solid rgba(180,60,60,0.4)',
  color: 'var(--danger)',
  cursor: 'pointer',
}
