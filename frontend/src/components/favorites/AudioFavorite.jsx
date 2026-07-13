import { useNavigate } from 'react-router-dom'
import { LuMusic } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import FavoriteButton from '../FavoriteButton'
import {
  cardWrapperStyle,
  rowWrapperStyle,
  hoverIn,
  hoverOut,
  rowFavoriteButtonStyle,
} from './favoriteStyles'

export default function AudioFavorite({ item, grid }) {
  const navigate = useNavigate()
  const open = () => navigate(`/audio/${item.item_id}`)
  const label = item.title || item.filename

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
          {item.has_artwork ? (
            <img
              src={mediaUrl(`/audio/${item.item_id}/artwork`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuMusic size={16} color="var(--text-muted)" style={{ opacity: 0.4 }} />
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
          {label}
        </div>
        <FavoriteButton type="audio" id={item.item_id} style={rowFavoriteButtonStyle} />
      </div>
    )
  }

  return (
    <div onClick={open} style={cardWrapperStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>
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
        {item.has_artwork ? (
          <img
            src={mediaUrl(`/audio/${item.item_id}/artwork`)}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <LuMusic size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
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
          {label}
        </div>
      </div>
      <FavoriteButton type="audio" id={item.item_id} />
    </div>
  )
}
