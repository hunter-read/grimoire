import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuCircleCheck,
  LuBold,
  LuItalic,
  LuStrikethrough,
  LuLink,
  LuList,
  LuListOrdered,
} from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'
import OIDCSettingsSection from './OIDCSettingsSection'

// ---------------------------------------------------------------------------
// Rich text editor — contentEditable with execCommand for bold/italic/strike,
// link, and bulleted/numbered lists. Emits HTML via onChange.
// ---------------------------------------------------------------------------

function RichTextEditor({ value, onChange, ariaLabel }) {
  const ref = useRef(null)
  const [, forceUpdate] = useState(0)

  // Keep DOM in sync when `value` arrives from outside (e.g. initial load).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || ''
    }
  }, [value])

  const exec = useCallback(
    (command, arg) => {
      ref.current?.focus()
      // execCommand is deprecated but still the simplest cross-browser path
      // for inline formatting in a contentEditable. Behaviour here is fine
      // for the small set of commands we support.
      document.execCommand(command, false, arg)
      if (ref.current) onChange(ref.current.innerHTML)
      forceUpdate((n) => n + 1)
    },
    [onChange]
  )

  const handleLink = useCallback(() => {
    const url = window.prompt('URL')
    if (!url) return
    // Allow http/https/mailto/relative; reject anything else (defense in depth;
    // the server also sanitizes).
    if (!/^(https?:|mailto:|\/|#)/i.test(url)) return
    exec('createLink', url)
  }, [exec])

  const handleInput = () => {
    if (ref.current) onChange(ref.current.innerHTML)
  }

  const Btn = ({ onClick, title, children }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={toolbarBtnStyle}
    >
      {children}
    </button>
  )

  return (
    <div style={editorWrapStyle}>
      <div style={toolbarStyle}>
        <Btn onClick={() => exec('bold')} title="Bold">
          <LuBold size={14} />
        </Btn>
        <Btn onClick={() => exec('italic')} title="Italic">
          <LuItalic size={14} />
        </Btn>
        <Btn onClick={() => exec('strikeThrough')} title="Strikethrough">
          <LuStrikethrough size={14} />
        </Btn>
        <span style={toolbarSepStyle} />
        <Btn onClick={handleLink} title="Link">
          <LuLink size={14} />
        </Btn>
        <span style={toolbarSepStyle} />
        <Btn onClick={() => exec('insertUnorderedList')} title="Bulleted list">
          <LuList size={14} />
        </Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Numbered list">
          <LuListOrdered size={14} />
        </Btn>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleInput}
        style={editableStyle}
      />
    </div>
  )
}

const editorWrapStyle = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  overflow: 'hidden',
}

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 6,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-panel)',
}

const toolbarBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: 'none',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-dim)',
}

const toolbarSepStyle = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  margin: '0 4px',
}

const editableStyle = {
  minHeight: 120,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text)',
  outline: 'none',
  lineHeight: 1.5,
}

// ---------------------------------------------------------------------------
// Authentication tab
// ---------------------------------------------------------------------------

export default function AuthenticationTab() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [envLocked, setEnvLocked] = useState(false)
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [messageDirty, setMessageDirty] = useState(false)
  const [messageSaving, setMessageSaving] = useState(false)
  const [messageSaved, setMessageSaved] = useState(false)

  useEffect(() => {
    settingsApi
      .get()
      .then((d) => {
        setValues({
          password_auth_enabled: !!d.password_auth_enabled,
          custom_login_message_enabled: !!d.custom_login_message_enabled,
        })
        setEnvLocked(!!d.password_auth_env_locked)
        setMessageDraft(d.custom_login_message || '')
      })
      .catch(() => {
        setValues({ password_auth_enabled: true, custom_login_message_enabled: false })
        setEnvLocked(false)
      })
  }, [])

  const toggle = async (key) => {
    const next = !values[key]
    setValues((v) => ({ ...v, [key]: next }))
    setSaving(key)
    try {
      await settingsApi.patch({ [key]: next })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
    } finally {
      setSaving(null)
    }
  }

  const saveMessage = async () => {
    setMessageSaving(true)
    try {
      await settingsApi.patch({ custom_login_message: messageDraft })
      setMessageDirty(false)
      setMessageSaved(true)
      setTimeout(() => setMessageSaved(false), 2000)
    } finally {
      setMessageSaving(false)
    }
  }

  if (values === null) return <Spinner size={20} />

  return (
    <div>
      {/* Custom login message */}
      <div style={{ marginBottom: 40 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('authSettings.customMessage.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('authSettings.customMessage.description')}
        </p>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            width: 'fit-content',
            marginBottom: values.custom_login_message_enabled ? 16 : 0,
          }}
        >
          <input
            type="checkbox"
            checked={values.custom_login_message_enabled}
            onChange={() => toggle('custom_login_message_enabled')}
            disabled={saving === 'custom_login_message_enabled'}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>
            {t('authSettings.customMessage.enable')}
          </span>
          {saving === 'custom_login_message_enabled' && <Spinner size={13} />}
          {saved === 'custom_login_message_enabled' && (
            <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />
          )}
        </label>

        {values.custom_login_message_enabled && (
          <>
            <RichTextEditor
              value={messageDraft}
              onChange={(html) => {
                setMessageDraft(html)
                setMessageDirty(true)
              }}
              ariaLabel={t('authSettings.customMessage.editorLabel')}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                onClick={saveMessage}
                disabled={!messageDirty || messageSaving}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: messageDirty ? 'var(--gold)' : 'var(--text-muted)',
                  cursor: messageDirty && !messageSaving ? 'pointer' : 'default',
                  opacity: messageDirty ? 1 : 0.7,
                }}
              >
                {messageSaving ? t('common.saving') : t('common.save')}
              </button>
              {messageSaved && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: 'var(--green)',
                    fontSize: 13,
                  }}
                >
                  <LuCircleCheck size={14} /> {t('common.saved')}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />

      {/* Password authentication */}
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('authSettings.passwordAuth.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('authSettings.passwordAuth.description')}
        </p>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: envLocked ? 'not-allowed' : 'pointer',
            width: 'fit-content',
            opacity: envLocked ? 0.7 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={values.password_auth_enabled}
            onChange={() => toggle('password_auth_enabled')}
            disabled={envLocked || saving === 'password_auth_enabled'}
            style={{
              width: 16,
              height: 16,
              cursor: envLocked ? 'not-allowed' : 'pointer',
              accentColor: 'var(--gold)',
            }}
          />
          <span style={{ fontSize: 14, color: 'var(--text)' }}>
            {t('authSettings.passwordAuth.enable')}
          </span>
          {saving === 'password_auth_enabled' && <Spinner size={13} />}
          {saved === 'password_auth_enabled' && (
            <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />
          )}
        </label>

        {envLocked && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            {t('authSettings.passwordAuth.envLocked', {
              value: values.password_auth_enabled ? 'true' : 'false',
            })}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '40px 0' }} />

      <OIDCSettingsSection />
    </div>
  )
}
