import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { overlay, panel, closeBtn, goldBtn, ghostBtn, fieldInput } from './sheetEditorStyles'

// Edits a form-fillable PDF character sheet by its AcroForm fields. Loads the
// fields on open; on save, writes the values back into the member's PDF.
export default function CharacterSheetEditor({ campaignId, memberId, onClose, onSaved }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [fields, setFields] = useState([])
  const [values, setValues] = useState({})
  const [fillable, setFillable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    campaigns
      .getMemberSheetFields(campaignId, memberId)
      .then((res) => {
        if (!active) return
        setFillable(res.fillable)
        setFields(res.fields)
        setValues(Object.fromEntries(res.fields.map((f) => [f.name, f.value])))
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [campaignId, memberId])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await campaigns.saveMemberSheetFields(campaignId, memberId, values)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const renderField = (f) => {
    if (f.type === 'checkbox') {
      return (
        <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={!!values[f.name]}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
          />
          {f.name}
        </label>
      )
    }
    if (f.options && f.options.length) {
      return (
        <label key={f.name} style={{ display: 'block', fontSize: 12 }}>
          <span style={{ color: 'var(--text-dim)' }}>{f.name}</span>
          <select
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            style={fieldInput}
          >
            <option value="">—</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )
    }
    return (
      <label key={f.name} style={{ display: 'block', fontSize: 12 }}>
        <span style={{ color: 'var(--text-dim)' }}>{f.name}</span>
        <input
          type="text"
          value={values[f.name] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          style={fieldInput}
        />
      </label>
    )
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <button onClick={onClose} aria-label={t('common.close')} style={closeBtn}>
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
          {t('members.editSheetTitle')}
        </h3>

        {loading ? (
          <Spinner size={18} />
        ) : !fillable ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {t('members.sheetNotFillable')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map(renderField)}
          </div>
        )}

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: '14px 0 0' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={ghostBtn}>
            {t('members.cancel')}
          </button>
          {fillable && !loading && (
            <button onClick={save} disabled={busy} style={goldBtn}>
              {busy ? t('members.saving') : t('members.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
