import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { overlay, panel, closeBtn, goldBtn, ghostBtn, fieldInput } from './sheetEditorStyles'

// Edits a form-fillable PDF character sheet by its AcroForm fields. Loads the
// fields on open; on save, writes the values back into the member's PDF.
type FieldValue = string | boolean

interface SheetField {
  name: string
  type?: string
  value?: FieldValue
  options?: string[] | null
}

interface SheetFields {
  fillable: boolean
  fields: SheetField[]
}

// The api module no longer has the sheet-fields helpers this editor calls (and
// nothing renders it), so this states what it expects of them.
const sheetApi = campaigns as unknown as {
  getMemberSheetFields: (campaignId: string, memberId: string) => Promise<SheetFields>
  saveMemberSheetFields: (
    campaignId: string,
    memberId: string,
    values: Record<string, FieldValue>
  ) => Promise<SheetFields>
}

interface CharacterSheetEditorProps {
  campaignId: string
  memberId: string
  onClose: () => void
  onSaved?: () => void
}

export default function CharacterSheetEditor({
  campaignId,
  memberId,
  onClose,
  onSaved,
}: CharacterSheetEditorProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [fields, setFields] = useState<SheetField[]>([])
  const [values, setValues] = useState<Record<string, FieldValue | undefined>>({})
  const [fillable, setFillable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    sheetApi
      .getMemberSheetFields(campaignId, memberId)
      .then((res) => {
        if (!active) return
        setFillable(res.fillable)
        setFields(res.fields)
        setValues(Object.fromEntries(res.fields.map((f) => [f.name, f.value])))
      })
      .catch((err) => active && setError((err as Error).message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [campaignId, memberId])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await sheetApi.saveMemberSheetFields(
        campaignId,
        memberId,
        values as Record<string, FieldValue>
      )
      onSaved?.()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const renderField = (f: SheetField) => {
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
            value={(values[f.name] as string | undefined) ?? ''}
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
          value={(values[f.name] as string | undefined) ?? ''}
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
