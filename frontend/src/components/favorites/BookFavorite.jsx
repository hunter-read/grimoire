import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuFileText } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import FavoriteButton from '../FavoriteButton'
import { CATEGORY_ICONS } from '../../constants'
import {
  cardWrapperStyle,
  rowWrapperStyle,
  hoverIn,
  hoverOut,
  rowFavoriteButtonStyle,
} from './favoriteStyles'
import LazyImg from '../LazyImg'
import CardLink from '../CardLink'

export default function BookFavorite({ item, grid }) {
  const { t } = useTranslation()
  const location = useLocation()
  const CatIcon = CATEGORY_ICONS[item.category] || LuFileText
  // A real link: middle click / ctrl-click opens the reader in a new tab (issue
  // #313). The `from` state rides along on in-page navigations only; a new tab
  // falls back to the reader's default back target, as any real link would.
  const cardLink = (
    <CardLink
      to={`/library/book/${item.item_id}`}
      state={{ from: location.pathname }}
      label={item.title}
    />
  )

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
          {item.has_thumbnail ? (
            <LazyImg
              src={mediaUrl(`/books/${item.item_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <CatIcon size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
          )}
        </div>
        <FavoriteButton type="book" id={item.item_id} />
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
            {item.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {item.category}
          </div>
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
        {item.has_thumbnail ? (
          <LazyImg
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
      <FavoriteButton type="book" id={item.item_id} style={rowFavoriteButtonStyle} />
    </div>
  )
}
