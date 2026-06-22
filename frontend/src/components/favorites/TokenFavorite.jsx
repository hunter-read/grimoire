import { useNavigate } from 'react-router-dom'
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

export default function TokenFavorite({ item, grid }) {
  const navigate = useNavigate()
  const open = () => navigate(`/tokens/${item.item_id}`)

  if (!grid) {
    return (
      <div onClick={open} style={rowWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
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
            <img
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
    <div onClick={open} style={cardWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
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
            loading="lazy"
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
