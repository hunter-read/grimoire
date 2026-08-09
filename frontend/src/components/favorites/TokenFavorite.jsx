import { LuUser } from 'react-icons/lu'
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

export default function TokenFavorite({ item, grid }) {
  // A real link: middle click / ctrl-click opens this item in a new tab (issue #313).
  const cardLink = <CardLink to={`/tokens/${item.item_id}`} label={item.filename} />

  if (!grid) {
    return (
      <div style={rowWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
        {cardLink}
        <div
          style={{
            width: 40,
            height: 40,
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
              src={mediaUrl(`/tokens/${item.item_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuUser size={16} color="var(--text-muted)" style={{ opacity: 0.4 }} />
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
        <FavoriteButton type="token" id={item.item_id} style={rowFavoriteButtonStyle} />
      </div>
    )
  }

  return (
    <div style={cardWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
      {cardLink}
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
          <LazyImg
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
