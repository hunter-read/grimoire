import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuFolder, LuDownload } from 'react-icons/lu'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { toTitleCase } from '../../utils'
import { tagZipBtnStyle, canDownloadTagType } from './tagDownload'

const PREFS_KEY = 'tagsFolderCollapsed'

/** Folder paths titled like the media pages: each segment Title-Cased. */
const folderTitle = (path) => path.split('/').map(toTitleCase).join(' / ')

/**
 * One collapsible folder-tag group inside a TagTypeSection: a folder header
 * (chevron + name) over the folder's items. Collapse state persists per
 * folder key ("{resource_type}:{path}") in user prefs, so each folder toggles
 * independently and remembers its state.
 *
 * The header carries a download button for the folder (issue #401), so a user
 * can take a tagged folder without navigating to where it lives on disk.
 */
export default function TagFolderGroup({
  resourceType,
  path,
  items,
  containerStyle,
  renderItem,
  tag,
  onDownload,
}) {
  const { t } = useTranslation()
  const key = `${resourceType}:${path}`
  const [collapsed, setCollapsed] = useState(() => Boolean(getUserPrefs()[PREFS_KEY]?.[key]))
  const title = folderTitle(path)
  const downloadable = onDownload && canDownloadTagType(resourceType) && items.length > 0

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    const prev = getUserPrefs()[PREFS_KEY] || {}
    saveUserPref(PREFS_KEY, { ...prev, [key]: next })
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flex: 1,
            minWidth: 0,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-dim)',
            textAlign: 'left',
          }}
        >
          <LuChevronDown
            size={14}
            aria-hidden="true"
            style={{
              transition: 'transform 0.15s',
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              flexShrink: 0,
            }}
          />
          <LuFolder size={14} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
          {title}
        </button>
        {downloadable && (
          <button
            type="button"
            onClick={() =>
              onDownload({
                title: t('tags.archiveFolder', { folder: title, tag }),
                params: { type: 'tag_folder', tag, resource_type: resourceType, folder: path },
              })
            }
            style={tagZipBtnStyle}
            title={t('tags.downloadFolder', { folder: title })}
          >
            <LuDownload size={11} /> {t('tags.download')}
          </button>
        )}
      </div>
      {!collapsed && <div style={containerStyle}>{items.map((item) => renderItem(item))}</div>}
    </div>
  )
}
