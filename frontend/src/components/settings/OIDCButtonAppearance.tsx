import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuLock, LuUpload, LuTrash2 } from 'react-icons/lu'
import { settings as settingsApi, type Schema } from '../../api'
import OidcLoginButton from '../OidcLoginButton'
import Spinner from '../Spinner'
import { useUnsavedChanges } from './settingsDirty'

type Settings = Schema<'SettingsResponse'>
type SettingsPatch = Schema<'SettingsPatch'>
type Draft = Record<string, string>

interface OIDCButtonAppearanceProps {
  data: Settings
  onSaved: (data: Settings) => void
}

/** Read a settings field by name; the form addresses fields as strings. */
const field = (data: Settings, key: string): unknown =>
  (data as unknown as Record<string, unknown>)[key]

const COLOR_FIELDS: [string, string][] = [
  ['oidc_button_bg_color', 'buttonBgColor'],
  ['oidc_button_text_color', 'buttonTextColor'],
  ['oidc_button_border_color', 'buttonBorderColor'],
]
const STYLE_FIELDS = [...COLOR_FIELDS.map(([key]) => key), 'oidc_button_radius']
// The button's wording lives here too, beside the look it is previewed with.
const DRAFT_FIELDS = ['oidc_button_text', ...STYLE_FIELDS]
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg'

// <input type="color"> only understands #rrggbb, so map the shorter and
// alpha forms onto it; the text box beside it keeps the exact value.
const toPickerValue = (v: string | undefined): string => {
  if (!HEX_COLOR_RE.test(v || '')) return '#000000'
  const hex = (v as string).slice(1)
  if (hex.length <= 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
  return `#${hex.slice(0, 6)}`
}

const isValid = (key: string, v: string): boolean => {
  if (v === '' || key === 'oidc_button_text') return true
  if (key === 'oidc_button_radius') return /^\d+$/.test(v) && Number(v) <= 40
  return HEX_COLOR_RE.test(v)
}

/**
 * Admin editor for the OIDC sign-in button (issue #377): its text, colors,
 * corner radius and an icon, with a live preview that follows each field as it
 * is typed. Provider-agnostic on purpose - the admin copies whatever their
 * IdP's branding guidelines call for.
 */
export default function OIDCButtonAppearance({ data, onSaved }: OIDCButtonAppearanceProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>({})
  const [savingField, setSavingField] = useState<string | null>(null)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const next: Draft = {}
    for (const k of DRAFT_FIELDS) next[k] = (field(data, k) as string | undefined) ?? ''
    setDraft(next)
  }, [data])

  const isLocked = (key: string) => !!field(data, `${key}_env_locked`)

  // Typed but not yet saved (fields save when they lose focus).
  const dirty = DRAFT_FIELDS.some(
    (k) =>
      k in draft &&
      !isLocked(k) &&
      draft[k].trim() !== ((field(data, k) as string | undefined) ?? '')
  )
  useUnsavedChanges('oidc-button', dirty)

  const run = async (key: string, request: () => Promise<unknown>) => {
    setSavingField(key)
    setError('')
    try {
      onSaved((await request()) as Settings)
      setSavedField(key)
      setTimeout(() => setSavedField(null), 1800)
    } catch (e) {
      setError((e as Error | null)?.message || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const commit = (key: string) => {
    const v = (draft[key] ?? '').trim()
    if (isLocked(key) || v === ((field(data, key) as string | undefined) ?? '')) return
    if (!isValid(key, v)) {
      setError(
        key === 'oidc_button_radius'
          ? t('authSettings.oidc.buttonInvalidRadius')
          : t('authSettings.oidc.buttonInvalidColor')
      )
      return
    }
    void run(key, () => settingsApi.patch({ [key]: v } as SettingsPatch))
  }

  const handleIconPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void run('oidc_button_icon', () => settingsApi.uploadOidcButtonIcon(file))
  }

  const status = (key: string) => (
    <>
      {isLocked(key) && (
        <span style={lockedTagStyle} title={t('authSettings.oidc.envLockedTitle')}>
          <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
        </span>
      )}
      {savingField === key && <Spinner size={12} />}
      <span role="status" style={{ display: 'inline-flex' }}>
        {savedField === key && (
          <>
            <LuCircleCheck size={13} aria-hidden="true" style={{ color: 'var(--green)' }} />
            <span className="visually-hidden">{t('common.saved')}</span>
          </>
        )}
      </span>
    </>
  )

  const textInputProps = (key: string) => ({
    id: key,
    type: 'text',
    // Named by the label's text alone: the label also holds the spinner and
    // "Saved" status, which would otherwise be read as part of the name.
    'aria-labelledby': `${key}-label`,
    autoComplete: 'off',
    spellCheck: false,
    value: draft[key] ?? '',
    disabled: isLocked(key),
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => commit(key),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur()
      }
    },
    style: { ...inputStyle, ...(isLocked(key) ? lockedInputStyle : {}) },
  })

  const iconLocked = isLocked('oidc_button_icon')
  const hasIcon = !!data.oidc_button_icon_url

  return (
    <div>
      <h4 style={subheadingStyle}>{t('authSettings.oidc.groups.loginButton')}</h4>
      <div style={{ ...hintStyle, marginTop: 0, marginBottom: 12 }}>
        {t('authSettings.oidc.buttonAppearanceHint')}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label htmlFor="oidc_button_text" style={fieldLabelStyle}>
          <span id="oidc_button_text-label">{t('authSettings.oidc.buttonText')}</span>
          {status('oidc_button_text')}
        </label>
        <input {...textInputProps('oidc_button_text')} aria-describedby="oidc_button_text-hint" />
        <div id="oidc_button_text-hint" style={hintStyle}>
          {t('authSettings.oidc.buttonTextHint')}
        </div>
      </div>

      {/* The preview is a picture of the button, not a button: inert keeps it
          out of the tab order and away from screen readers, which hear its
          text from the group instead. */}
      <div style={previewStyle} aria-label={t('authSettings.oidc.buttonPreview')} role="group">
        <span className="sr-only">{draft.oidc_button_text || t('login.oidcDefault')}</span>
        <div inert>
          <OidcLoginButton
            onClick={undefined}
            label={draft.oidc_button_text || t('login.oidcDefault')}
            bgColor={draft.oidc_button_bg_color}
            textColor={draft.oidc_button_text_color}
            borderColor={draft.oidc_button_border_color}
            radius={draft.oidc_button_radius}
            iconUrl={data.oidc_button_icon_url}
          />
        </div>
      </div>

      <div style={gridStyle}>
        {COLOR_FIELDS.map(([key, labelKey]) => (
          <div key={key}>
            <label htmlFor={key} style={fieldLabelStyle}>
              <span id={`${key}-label`}>{t(`authSettings.oidc.${labelKey}`)}</span>
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
            <span id="oidc_button_radius-label">{t('authSettings.oidc.buttonRadius')}</span>
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

      {error && (
        <div role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// Matches the sub-block headings in OIDCSettingsSection: a step below the
// setting's own h3, in the body face rather than the display one.
const subheadingStyle: CSSProperties = {
  fontFamily: "'Alegreya Sans', sans-serif",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: 0,
  color: 'var(--text-dim)',
  margin: '0 0 4px',
}

const previewStyle: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
  maxWidth: 360,
  marginBottom: 14,
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 12,
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text-dim)',
  marginBottom: 5,
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
  lineHeight: 1.5,
}

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  width: '100%',
  fontSize: 13,
  padding: '7px 10px',
  boxSizing: 'border-box',
  background: 'var(--bg-input)',
  color: 'var(--text)',
}

const lockedInputStyle: CSSProperties = {
  background: 'var(--bg-deep)',
  color: 'var(--text-muted)',
  cursor: 'not-allowed',
}

const swatchStyle: CSSProperties = {
  width: 34,
  height: 32,
  padding: 2,
  flexShrink: 0,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-input)',
  cursor: 'pointer',
}

const lockedTagStyle: CSSProperties = {
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

const secondaryBtnStyle: CSSProperties = {
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

const disabledBtnStyle: CSSProperties = { opacity: 0.6, cursor: 'not-allowed' }

const dangerBtnStyle: CSSProperties = {
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
