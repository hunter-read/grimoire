import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuHeart, LuMap, LuUser, LuFileText, LuLibrary } from 'react-icons/lu'
import { mediaUrl } from '../api'
import { useFavorites } from '../context/FavoritesContext'
import FavoriteButton from '../components/FavoriteButton'
import { CATEGORY_ICONS } from '../constants'

function BookFavorite({ item }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const CatIcon = CATEGORY_ICONS[item.category] || LuFileText
  return (
    <div
      onClick={() => navigate(`/library/book/${item.item_id}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        style={{
          width: 32,
          height: 44,
          borderRadius: 3,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.has_thumbnail ? (
          <img
            src={mediaUrl(`/books/${item.item_id}/thumbnail`)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <CatIcon size={14} color="var(--text-muted)" />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          {item.category}
          {item.page_count > 0 ? ` · ${t('bookRow.pages', { count: item.page_count })}` : ''}
        </div>
      </div>
      <FavoriteButton
        type="book"
        id={item.item_id}
        style={{
          position: 'static',
          background: 'none',
          width: 'auto',
          height: 'auto',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

function MapFavorite({ item }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/maps/${item.item_id}`)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        style={{
          width: '100%',
          height: 110,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.has_thumbnail ? (
          <img
            src={mediaUrl(`/maps/${item.item_id}/thumbnail`)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuMap size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div
          style={{
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.filename}
        </div>
      </div>
      <FavoriteButton type="map" id={item.item_id} />
    </div>
  )
}

function TokenFavorite({ item }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/tokens/${item.item_id}`)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: '1/1',
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.has_thumbnail ? (
          <img
            src={mediaUrl(`/tokens/${item.item_id}/thumbnail`)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuUser size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div
          style={{
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.filename}
        </div>
      </div>
      <FavoriteButton type="token" id={item.item_id} />
    </div>
  )
}

function SystemFavorite({ item }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/library/system/${item.item_id}`)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-light)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div
        style={{
          width: 32,
          height: 44,
          borderRadius: 3,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.cover_book_id ? (
          <img
            src={mediaUrl(`/books/${item.cover_book_id}/thumbnail`)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuLibrary size={14} color="var(--text-muted)" />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        {item.publisher && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {item.publisher}
          </div>
        )}
      </div>
      <FavoriteButton
        type="system"
        id={item.item_id}
        style={{
          position: 'static',
          background: 'none',
          width: 'auto',
          height: 'auto',
          borderRadius: 0,
        }}
      />
    </div>
  )
}

const CARD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 12,
}

export default function FavoritesView() {
  const { t } = useTranslation()
  const { items } = useFavorites()

  const systems = items.filter((i) => i.item_type === 'system')
  const books = items.filter((i) => i.item_type === 'book')
  const maps = items.filter((i) => i.item_type === 'map')
  const tokens = items.filter((i) => i.item_type === 'token')

  if (items.length === 0) {
    return (
      <div
        className="fade-in"
        style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}
      >
        <LuHeart size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{t('favorites.empty')}</div>
        <div style={{ fontSize: 14 }}>{t('favorites.emptyHint')}</div>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <LuHeart size={20} fill="var(--gold)" color="var(--gold)" /> {t('favorites.title')}
      </h2>

      {systems.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            {t('favorites.systems', { count: systems.length })}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {systems.map((item) => (
              <SystemFavorite key={item.item_id} item={item} />
            ))}
          </div>
        </section>
      )}

      {books.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            {t('favorites.books', { count: books.length })}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {books.map((item) => (
              <BookFavorite key={item.item_id} item={item} />
            ))}
          </div>
        </section>
      )}

      {maps.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            {t('favorites.maps', { count: maps.length })}
          </h3>
          <div style={CARD_GRID}>
            {maps.map((item) => (
              <MapFavorite key={item.item_id} item={item} />
            ))}
          </div>
        </section>
      )}

      {tokens.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 12,
            }}
          >
            {t('favorites.tokens', { count: tokens.length })}
          </h3>
          <div style={CARD_GRID}>
            {tokens.map((item) => (
              <TokenFavorite key={item.item_id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
