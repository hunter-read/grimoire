import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuDownload } from 'react-icons/lu'
import { getDefaultViewMode } from '../../hooks/useViewMode'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { gridStyle, ROW_LIST_STYLE } from '../favorites/favoriteStyles'
import TagFolderGroup from './TagFolderGroup'
import { tagZipBtnStyle, canDownloadTagType } from './tagDownload'

const PREFS_KEY = 'tagsSectionCollapsed'

/**
 * One collapsible section on the tags detail pane for a single resource type
 * (Maps/Tokens/Audio/…): its directly-tagged items first, then each folder-tag
 * group nested beneath — so map/token/audio folders live under their main type
 * heading. Collapse state persists per type in user prefs.
 *
 * The heading carries a download button for the whole section (issue #401).
 * Systems are the one type without one: a tagged system is a shelf rather than
 * a file, so it is excluded from tag archives and downloaded from its own page.
 */
export default function TagTypeSection({
  type,
  title,
  items,
  folders,
  renderItem,
  tag,
  onDownload,
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(() => Boolean(getUserPrefs()[PREFS_KEY]?.[type]))
  const mode = getDefaultViewMode(type)
  const grid = mode !== 'list'
  const containerStyle = grid ? gridStyle(mode) : ROW_LIST_STYLE
  const hasFolderItems = folders.some((g) => g.items.length > 0)
  const downloadable =
    onDownload && canDownloadTagType(type) && (items.length > 0 || hasFolderItems)

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
          {folders.map((g) => (
            <TagFolderGroup
              key={`${g.resource_type}:${g.path}`}
              resourceType={g.resource_type}
              path={g.path}
              items={g.items}
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
