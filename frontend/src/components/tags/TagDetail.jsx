import { useTranslation } from 'react-i18next'
import { LuPencil, LuTrash2, LuCheck, LuX, LuHeart } from 'react-icons/lu'
import TagTypeSection from './TagTypeSection'
import BookFavorite from '../favorites/BookFavorite'
import MapFavorite from '../favorites/MapFavorite'
import TokenFavorite from '../favorites/TokenFavorite'
import AudioFavorite from '../favorites/AudioFavorite'
import SystemFavorite from '../favorites/SystemFavorite'

const CARD_FOR_TYPE = {
  system: SystemFavorite,
  book: BookFavorite,
  map: MapFavorite,
  token: TokenFavorite,
  audio: AudioFavorite,
}

const TYPE_ORDER = ['system', 'book', 'map', 'token', 'audio']

/**
 * Detail pane for a selected tag: header (favorite/rename/delete), then a
 * collapsible section per resource type. Each section shows that type's
 * directly-tagged items, with folder-derived tags nested beneath (so map/token/
 * audio folders sit under their main type heading). Rendered by TagsView; kept
 * in its own file to satisfy one-component-per-file.
 */
export default function TagDetail({
  detail,
  isEditor,
  renaming,
  renameValue,
  setRenameValue,
  setRenaming,
  saveRename,
  deleteTag,
  favorited,
  onToggleFavorite,
  byType,
}) {
  const { t } = useTranslation()
  const directCount = detail.items.length
  const folderCount = (detail.folders || []).reduce((n, g) => n + g.items.length, 0)
  const total = directCount + folderCount

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        {renaming ? (
          <>
            <input
              autoFocus
              aria-label={t('tags.renameDisplay')}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              style={{
                fontSize: 18,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}
            />
            <button
              onClick={saveRename}
              title={t('tags.save')}
              aria-label={t('tags.save')}
              style={iconBtn}
            >
              <LuCheck size={16} />
            </button>
            <button
              onClick={() => setRenaming(false)}
              title={t('tags.cancel')}
              aria-label={t('tags.cancel')}
              style={iconBtn}
            >
              <LuX size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onToggleFavorite}
              title={favorited ? t('tags.unfavorite') : t('tags.favorite')}
              aria-label={favorited ? t('tags.unfavorite') : t('tags.favorite')}
              aria-pressed={favorited}
              style={{ ...iconBtn, color: favorited ? 'var(--gold)' : 'var(--text-dim)' }}
            >
              <LuHeart size={15} fill={favorited ? 'var(--gold)' : 'none'} />
            </button>
            {/* Body font (not the Cinzel display face used for page headings) so
                the user's own tag casing shows verbatim instead of small-caps. */}
            <h3
              style={{
                fontSize: 20,
                fontWeight: 600,
                margin: 0,
                fontFamily: "'Alegreya Sans', sans-serif",
                letterSpacing: 'normal',
                textTransform: 'none',
                color: 'var(--text)',
              }}
            >
              {detail.display}
            </h3>
            {detail.category && (
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {t(`tags.category_${detail.category}`, { defaultValue: detail.category })}
              </span>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {t('tags.count', { count: total })}
            </span>
            {isEditor && (
              <>
                <button
                  onClick={() => {
                    setRenameValue(detail.display)
                    setRenaming(true)
                  }}
                  title={t('tags.rename')}
                  aria-label={t('tags.rename')}
                  style={{ ...iconBtn, marginLeft: 'auto' }}
                >
                  <LuPencil size={14} />
                </button>
                <button
                  onClick={deleteTag}
                  title={t('tags.deleteTag')}
                  aria-label={t('tags.deleteTag')}
                  style={iconBtn}
                >
                  <LuTrash2 size={14} />
                </button>
              </>
            )}
          </>
        )}
      </div>

      {total === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 20 }}>
          {t('tags.noItems', { tag: detail.display })}
        </div>
      ) : (
        // One collapsible section per type: its directly-tagged items, with that
        // type's folder groups nested beneath — so map folders sit under Maps,
        // tokens under Tokens, etc. Each folder group lists everything inside it.
        TYPE_ORDER.map((type) => {
          const items = byType(type)
          const folders = (detail.folders || []).filter((g) => g.resource_type === type)
          if (items.length === 0 && folders.length === 0) return null
          const Card = CARD_FOR_TYPE[type]
          return (
            <TagTypeSection
              key={type}
              type={type}
              title={t(`tags.${type}s`)}
              items={items}
              folders={folders}
              renderItem={(item, grid) => <Card key={item.item_id} item={item} grid={grid} />}
            />
          )
        })
      )}
    </>
  )
}

const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
