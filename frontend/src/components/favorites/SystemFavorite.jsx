import { LuLibrary } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import FavoriteButton from '../FavoriteButton'
import {
  cardWrapperStyle,
  rowWrapperStyle,
  hoverIn,
  hoverOut,
  rowFavoriteButtonStyle,
} from './favoriteStyles'
import LazyImg from '../LazyImg'
import CardLink from '../CardLink'

export default function SystemFavorite({ item, grid }) {
  const publisher = (item.publishers || []).map((p) => p.name).join(', ')
  // A real link: middle click / ctrl-click opens this item in a new tab (issue #313).
  const cardLink = <CardLink to={`/library/system/${item.item_id}`} label={item.name} />

  if (grid) {
    return (
      <div style={cardWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
        {cardLink}
        <div
          style={{
            width: '100%',
            aspectRatio: '3 / 4',
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.cover_book_id ? (
            <LazyImg
              src={mediaUrl(`/books/${item.cover_book_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuLibrary size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
          )}
        </div>
        <FavoriteButton type="system" id={item.item_id} />
        <div style={{ padding: '8px 10px' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.name}
          </div>
          {publisher && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {publisher}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={rowWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      {cardLink}
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
          <LazyImg
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
        {publisher && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{publisher}</div>
        )}
      </div>
      <FavoriteButton type="system" id={item.item_id} style={rowFavoriteButtonStyle} />
    </div>
  )
}
