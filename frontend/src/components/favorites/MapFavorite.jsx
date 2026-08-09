import { LuMap } from 'react-icons/lu'
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

export default function MapFavorite({ item, grid }) {
  // A real link: middle click / ctrl-click opens this item in a new tab (issue #313).
  const cardLink = <CardLink to={`/maps/${item.item_id}`} label={item.filename} />

  if (!grid) {
    return (
      <div style={rowWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
        {cardLink}
        <div
          style={{
            width: 56,
            height: 36,
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {item.has_thumbnail ? (
            <LazyImg
              src={mediaUrl(`/maps/${item.item_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuMap size={16} color="var(--text-muted)" style={{ opacity: 0.4 }} />
          )}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.filename}
        </div>
        <FavoriteButton type="map" id={item.item_id} style={rowFavoriteButtonStyle} />
      </div>
    )
  }

  return (
    <div style={cardWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      {cardLink}
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
          <LazyImg
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
