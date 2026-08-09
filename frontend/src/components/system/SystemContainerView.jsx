import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuLibrary, LuPencil } from 'react-icons/lu'
import SystemCard from '../library/SystemCard'
import CoverUpload from './CoverUpload'
import { systemDisplayName } from '../../utils/systemDisplayName'
import { systemCoverUrl } from '../../utils/systemCoverUrl'

/**
 * Detail view for a *container* system — a folder whose children are systems in
 * their own right rather than categories (issues #261, #262).
 *
 * Parent-system containers ("Dungeons & Dragons" holding 3e/4e/5e) and one-page
 * collections ("One Page RPGs" holding dozens of tiny games) share this view:
 * both present their children as a grid of system cards, so navigating into a
 * container feels the same as the main library grid rather than dropping into a
 * flat book list.
 *
 * Any books sitting loose at the container's own root are rendered underneath by
 * the caller, which owns the normal book-list rendering.
 */
export default function SystemContainerView({
  system,
  viewMode,
  canEdit = false,
  onBack,
  onCoverChange,
  headerExtra,
}) {
  const { t } = useTranslation()
  const [editingCover, setEditingCover] = useState(false)
  const children = system.children || []
  const coverUrl = systemCoverUrl(system)
  const compact = viewMode === 'compact'
  const list = viewMode === 'list'
  const minCard = compact ? '130px' : '220px'

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 16,
          fontSize: 14,
        }}
      >
        <LuArrowLeft size={16} />
        {t('systemDetail.backToLibrary')}
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              style={{
                width: 60,
                height: 80,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid var(--border)',
                flexShrink: 0,
                display: 'block',
              }}
            />
          ) : (
            <LuLibrary size={22} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
          )}
          <h1 style={{ fontSize: 28, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {systemDisplayName(system)}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canEdit && (
            <button
              onClick={() => setEditingCover((v) => !v)}
              title={t('systemEditor.uploadCover')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                background: 'none',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <LuPencil size={13} /> {t('systemEditor.uploadCover')}
            </button>
          )}
          {headerExtra}
        </div>
      </div>

      <p
        style={{
          color: 'var(--text-dim)',
          fontSize: 15,
          fontFamily: 'Alegreya, serif',
          fontStyle: 'italic',
          marginBottom: 20,
        }}
      >
        {system.description || t('systemContainer.subtitle', { count: children.length })}
      </p>

      {canEdit && editingCover && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <CoverUpload system={system} onChange={onCoverChange} />
        </div>
      )}

      {children.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('systemContainer.empty')}</p>
      ) : (
        <div
          style={
            list
              ? { display: 'flex', flexDirection: 'column', gap: 8 }
              : {
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}, 1fr))`,
                  gap: compact ? 12 : 20,
                }
          }
        >
          {children.map((child) => (
            <SystemCard
              key={child.id}
              system={child}
              to={`/library/system/${child.id}`}
              compact={compact}
              list={list}
            />
          ))}
        </div>
      )}
    </div>
  )
}
