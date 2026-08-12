import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'

/**
 * Field picker for "apply to all" in the bulk-edit carousel (issue #260).
 *
 * The carousel edits one item at a time, so changing a field only ever touched
 * the item on screen — surprising for a dialog labelled "Edit N items". This
 * dialog copies the current item's values for the ticked fields onto every
 * other selected item's draft, which is what people reach bulk edit for in the
 * first place (moving a stack of books into one category).
 *
 * Everything starts unchecked: copying a value across the whole selection is
 * destructive to whatever those items already had, so it only ever happens for
 * fields explicitly ticked. Nothing is written until "Save all" — this only
 * edits drafts, so the result stays reviewable by paging through the carousel.
 */
export default function ApplyToAllDialog({ fields, count, values, onApply, onClose }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState([])

  const toggle = (field) =>
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    )

  const allSelected = selected.length === fields.length && fields.length > 0
  const toggleAll = () => setSelected(allSelected ? [] : fields.map((f) => f.field))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-all-title"
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span id="apply-all-title" style={{ fontSize: 15, fontWeight: 600 }}>
            {t('bulkEdit.applyToAllTitle', { count })}
          </span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('bulkEdit.applyToAllHint', { count })}
        </p>

        <button type="button" onClick={toggleAll} style={selectAllBtn}>
          {allSelected ? t('bulkEdit.selectNone') : t('bulkEdit.selectAll')}
        </button>

        <div style={list}>
          {fields.map(({ field, label }) => (
            <label key={field} style={row}>
              <input
                type="checkbox"
                checked={selected.includes(field)}
                onChange={() => toggle(field)}
                aria-label={label}
                style={{ marginTop: 3, cursor: 'pointer' }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
                {/* The value that would be copied, so the choice is informed —
                    especially for fields that are currently empty. */}
                <div style={preview}>
                  {values[field] || (
                    <span style={{ fontStyle: 'italic' }}>{t('bulkEdit.emptyValue')}</span>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={() => {
              onApply(selected)
              onClose()
            }}
            disabled={selected.length === 0}
            style={{
              ...goldBtn,
              opacity: selected.length ? 1 : 0.5,
              cursor: selected.length ? 'pointer' : 'default',
            }}
          >
            {t('bulkEdit.applySelected', { count: selected.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  // Above the bulk-edit modal itself (1200).
  zIndex: 1300,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 480,
  maxWidth: '94vw',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const selectAllBtn = {
  alignSelf: 'flex-start',
  background: 'none',
  border: 'none',
  padding: 0,
  marginBottom: 8,
  fontSize: 12,
  color: 'var(--gold-dim)',
  cursor: 'pointer',
  textDecoration: 'underline',
}
const list = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  minHeight: 0,
}
const row = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 10,
  alignItems: 'start',
  padding: '8px 10px',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  cursor: 'pointer',
}
const preview = {
  fontSize: 12,
  color: 'var(--text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const cancelBtn = {
  padding: '7px 16px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 14,
  cursor: 'pointer',
}
const goldBtn = {
  padding: '7px 18px',
  borderRadius: 6,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 14,
  fontWeight: 600,
}
