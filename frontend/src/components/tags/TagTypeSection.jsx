import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuDownload } from 'react-icons/lu'
import { getDefaultViewMode } from '../../hooks/useViewMode'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { gridStyle, ROW_LIST_STYLE } from '../favorites/favoriteStyles'
import TagFolderGroup from './TagFolderGroup'
import LoadMoreSentinel from '../LoadMoreSentinel'
import Spinner from '../Spinner'
import { tagZipBtnStyle, canDownloadTagType } from './tagDownload'
import { shouldAutoCollapse } from '../../utils/autoCollapse'

const PREFS_KEY = 'tagsSectionCollapsed'

/** The paged-list key for one type's directly-tagged items. */
export const typeListKey = (type) => `type\u0000${type}`

/** The paged-list key for one tagged folder's contents. */
export const folderListKey = (type, key) => `folder\u0000${type}\u0000${key}`

/**
 * One collapsible section on the tags detail pane for a single resource type
 * (Maps/Tokens/Audio/…): its directly-tagged items first, then each folder-tag
 * group nested beneath — so map/token/audio folders live under their main type
 * heading. Collapse state persists per type in user prefs; until the user
 * toggles a type, its section follows `defaultCollapsed`.
 *
 * The heading carries a download button for the whole section (issue #401).
 * Systems are the one type without one: a tagged system is a shelf rather than
 * a file, so it is excluded from tag archives and downloaded from its own page.
 */
export default function TagTypeSection({
  type,
  title,
  count = 0,
  folders,
  pages,
  onLoad,
  renderItem,
  tag,
  onDownload,
  defaultCollapsed = false,
}) {
  const { t } = useTranslation()
  const [chosen, setCollapsed] = useState(() => getUserPrefs()[PREFS_KEY]?.[type])
  const collapsed = chosen ?? defaultCollapsed
  const mode = getDefaultViewMode(type)
  const grid = mode !== 'list'
  const containerStyle = grid ? gridStyle(mode) : ROW_LIST_STYLE
  const hasFolderItems = folders.some((g) => g.count > 0)
  // Many large tagged folders start closed, like long sections do: each open
  // folder loads its first page as it comes into view, and a tag on dozens of
  // folders would otherwise ask for all of them at once (issue #221).
  const foldersCollapsed = shouldAutoCollapse(
    folders.reduce((n, g) => n + g.count, 0),
    folders.length
  )
  const downloadable = onDownload && canDownloadTagType(type) && (count > 0 || hasFolderItems)
  // The directly-tagged items load a page at a time once the section is open.
  const listKey = typeListKey(type)
  const itemList = pages.get(listKey)
  const items = itemList ? itemList.items : []
  const hasMore = count > 0 && (!itemList || itemList.hasMore)
  const loading = !!itemList?.loading

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    const prev = getUserPrefs()[PREFS_KEY] || {}
    saveUserPref(PREFS_KEY, { ...prev, [type]: next })
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 14,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          <LuChevronDown
            size={16}
            aria-hidden="true"
            style={{
              transition: 'transform 0.15s',
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              flexShrink: 0,
            }}
          />
          {title}
        </button>
        {downloadable && (
          <button
            type="button"
            onClick={() =>
              onDownload({
                title: t('tags.archiveType', { type: title, tag }),
                params: { type: 'tag_type', tag, resource_type: type },
              })
            }
            style={tagZipBtnStyle}
            title={t('tags.downloadType', { type: title, tag })}
          >
            <LuDownload size={11} /> {t('tags.download')}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {items.length > 0 && (
            <div style={containerStyle}>{items.map((item) => renderItem(item, grid))}</div>
          )}
          {loading && (
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
              <Spinner size={18} />
            </div>
          )}
          {count > 0 && (
            <LoadMoreSentinel
              active={hasMore && !loading}
              count={items.length}
              onVisible={() => onLoad(listKey)}
            />
          )}
          {folders.map((g) => (
            <TagFolderGroup
              key={`${g.resource_type}:${g.path}`}
              resourceType={g.resource_type}
              path={g.path}
              count={g.count}
              list={pages.get(folderListKey(g.resource_type, g.key))}
              onLoad={() => onLoad(folderListKey(g.resource_type, g.key))}
              defaultCollapsed={foldersCollapsed}
              containerStyle={containerStyle}
              renderItem={(item) => renderItem(item, grid)}
              tag={tag}
              onDownload={onDownload}
            />
          ))}
        </>
      )}
    </section>
  )
}
