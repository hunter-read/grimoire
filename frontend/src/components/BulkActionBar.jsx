import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTag, LuLibrary, LuPencil, LuGrid2X2Plus } from 'react-icons/lu'

/**
 * Sticky bottom action bar shown while a library view is in bulk-select mode.
 *
 * Renders the selection count, an inline "tag" input (when `onApplyTags` is
 * given), buttons for the other bulk actions, and a Done button. The view owns
 * the action handlers and any modals they open.
 */
export default function BulkActionBar({
  count,
  onApplyTags,
  onAddToCampaign,
  onBulkEdit,
  onAddToSoundboard,
  onDone,
  applying = false,
}) {
  const { t } = useTranslation()
  const [tagInput, setTagInput] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (onApplyTags) setTimeout(() => inputRef.current?.focus(), 50)
  }, [onApplyTags])

  const disabled = count === 0

  const applyTags = async () => {
    const tags = tagInput
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
    if (!tags.length || disabled || applying) return
    await onApplyTags(tags)
    setTagInput('')
    inputRef.current?.focus()
  }

  return (
    <>
      <style>{`
        .bulk-bar { display: grid; grid-template-areas: 'count input' 'actions actions'; grid-template-columns: auto 1fr; gap: 8px; }
        .bulk-bar-actions { grid-area: actions; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        @media (min-width: 640px) {
          .bulk-bar { grid-template-areas: 'count input actions'; grid-template-columns: auto minmax(0, 360px) 1fr; align-items: center; }
          .bulk-bar-actions { justify-content: flex-end; }
        }
      `}</style>
      <div
        className="bulk-bar"
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 200,
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            gridArea: 'count',
            fontSize: 14,
            color: count > 0 ? 'var(--text)' : 'var(--text-muted)',
            alignSelf: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {count > 0 ? t('common.selected', { count }) : t('common.nothingSelected')}
        </span>

        {onApplyTags && (
          <input
            ref={inputRef}
            type="text"
            aria-label={t('bulk.tagsPlaceholder')}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyTags()}
            placeholder={t('bulk.tagsPlaceholder')}
            style={{ gridArea: 'input', fontSize: 14, width: '100%', boxSizing: 'border-box' }}
          />
        )}

        <div className="bulk-bar-actions">
          {onApplyTags && (
            <button
              onClick={applyTags}
              disabled={!tagInput.trim() || disabled || applying}
              style={{
                ...goldBtn,
                opacity: !tagInput.trim() || disabled || applying ? 0.5 : 1,
              }}
            >
              <LuTag size={13} />
              {applying ? t('bulk.applying') : t('bulk.addTags')}
            </button>
          )}
          {onAddToCampaign && (
            <button
              onClick={onAddToCampaign}
              disabled={disabled}
              style={{ ...toolBtn, opacity: disabled ? 0.5 : 1 }}
            >
              <LuLibrary size={13} />
              {t('bulk.addToCampaign')}
            </button>
          )}
          {onAddToSoundboard && (
            <button
              onClick={onAddToSoundboard}
              disabled={disabled}
              style={{ ...toolBtn, opacity: disabled ? 0.5 : 1 }}
            >
              <LuGrid2X2Plus size={13} />
              {t('soundboard.addSelected')}
            </button>
          )}
          {onBulkEdit && (
            <button
              onClick={onBulkEdit}
              disabled={disabled}
              style={{ ...toolBtn, opacity: disabled ? 0.5 : 1 }}
            >
              <LuPencil size={13} />
              {t('bulk.edit')}
            </button>
          )}
          <button onClick={onDone} style={toolBtn}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </>
  )
}

const toolBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}
const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 18px',
  borderRadius: 6,
  fontSize: 14,
  cursor: 'pointer',
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: 'none',
}
