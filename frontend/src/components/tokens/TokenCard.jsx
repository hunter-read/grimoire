import { useTranslation } from 'react-i18next'
import { LuUser } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatSize } from '../../utils'
import FavoriteButton from '../FavoriteButton'

export default function TokenCard({ token, onClick, bulkMode, selected, onToggle }) {
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
      aria-label={token.filename}
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
      {!bulkMode && <FavoriteButton type="token" id={token.id} />}
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
          {selected && (
            <span style={{ fontSize: 11, color: 'var(--bg-deep)', fontWeight: 700 }}>✓</span>
          )}
        </div>
      )}
      {token.is_explicit && (
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
            zIndex: 2,
            fontSize: 11,
            padding: '1px 5px',
            borderRadius: 6,
            background: 'rgba(180,60,60,0.85)',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          {t('tokens.explicit')}
        </div>
      )}
      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {token.has_thumbnail ? (
          <img
            src={mediaUrl(`/tokens/${token.id}/thumbnail`)}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuUser size={32} color="var(--text-muted)" aria-hidden="true" style={{ opacity: 0.4 }} />
        )}
        {token.is_missing && (
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
            {t('tokens.missing')}
          </div>
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {token.filename}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatSize(token.file_size)}
        </div>
      </div>
    </div>
  )
}
