import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import { homebrew as homebrewApi } from '../../api'
import FieldRenderer from './FieldRenderer'
import { goldBtn, ghostBtn, iconBtn } from './characterStyles'

/**
 * Write or edit a homebrew entry.
 *
 * The form is generated from the content type's own `fields` and rendered
 * through `FieldRenderer` — the same component that draws a character sheet and
 * a catalog entry. A content type is a field schema applied to entries, so
 * authoring one needs no bespoke form.
 */
export default function HomebrewDialog({
  schemaId,
  contentType,
  typeDefinition = {},
  entry = null,
  onSaved,
  onClose,
}) {
  const { t } = useTranslation()
  const [data, setData] = useState(entry?.data || {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fields = typeDefinition.fields || {}
  const editing = !!entry?.id

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      const saved = editing
        ? await homebrewApi.update(entry.id, { data })
        : await homebrewApi.create({ schema_id: schemaId, content_type: contentType, data })
      onSaved?.(saved)
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? t('homebrew.editTitle') : t('homebrew.createTitle')}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <form
        onSubmit={save}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 560,
          maxHeight: '85vh',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          style={{ ...iconBtn, position: 'absolute', top: 14, right: 14 }}
        >
          <LuX size={18} />
        </button>

        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>
          {editing ? t('homebrew.editTitle') : t('homebrew.createTitle')}
        </h2>

        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {Object.entries(fields).map(([name, definition]) => (
            <div
              key={name}
              style={definition.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}
            >
              <FieldRenderer
                name={name}
                definition={definition}
                value={data[name]}
                onChange={(value) => setData((prev) => ({ ...prev, [name]: value }))}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={ghostBtn}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={saving} style={goldBtn}>
            {saving ? t('characters.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
