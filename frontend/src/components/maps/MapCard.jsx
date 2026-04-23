import { useTranslation } from 'react-i18next'
import { LuMap, LuCheck } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatSize } from '../../utils'
import FavoriteButton from '../FavoriteButton'

export default function MapCard({ map, onClick, bulkMode, selected, onToggle }) {
  const { t } = useTranslation()

  const handleClick = (e) => {
    if (bulkMode) {
      e.stopPropagation()
      onToggle()
      return
    }
    onClick()
  }

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick(e)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={map.filename}
      aria-pressed={bulkMode ? selected : undefined}
      style={{
        background: selected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: bulkMode ? 'default' : 'pointer',
        transition: 'border-color 0.15s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!bulkMode && !selected) e.currentTarget.style.borderColor = 'var(--border-light)'
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {!bulkMode && <FavoriteButton type="map" id={map.id} />}
      {bulkMode && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            width: 20,
            height: 20,
            borderRadius: 4,
            background: selected ? 'var(--gold)' : 'rgba(0,0,0,0.55)',
            border: selected ? 'none' : '2px solid rgba(255,255,255,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        >
          {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: 140,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {map.has_thumbnail ? (
          <img
            src={mediaUrl(`/maps/${map.id}/thumbnail`)}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuMap size={32} color="var(--text-muted)" aria-hidden="true" style={{ opacity: 0.4 }} />
        )}
        {map.is_missing && (
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 6,
              background: 'rgba(200,134,10,0.9)',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            {t('maps.missing')}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: 15,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {map.filename}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatSize(map.file_size)}
        </div>
      </div>
    </div>
  )
}
