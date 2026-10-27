import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import TagPicker from '../metadata/TagPicker'

/**
 * Inline tag editor for the media detail sidebars. Wraps the shared TagPicker so
 * the dropdown (favorites-first, existing-tag suggestions) is consistent
 * everywhere; saves on every change and offers a Done button to finish. Tags
 * suggestions are scoped to `resourceType` (map/token/audio) when given.
 */
export default function InlineTagEditor({ tags, onSave, onCancel, resourceType = null }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState([...tags])

  const update = (next) => {
    setDraft(next)
    onSave(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TagPicker value={draft} onChange={update} resourceType={resourceType} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={cancelBtnStyle}>
          {t('common.done')}
        </button>
      </div>
    </div>
  )
}

const cancelBtnStyle = {
  padding: '3px 10px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
}
