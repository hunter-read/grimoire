import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload } from 'react-icons/lu'

import { mediaUrl } from '../../api'
import useVariantOptions from '../useVariantOptions'

/**
 * "Download version" rows for a book's overflow menu.
 *
 * The plain download row always fetches the main version; when a book has other
 * versions the user has to be able to say which file they want (issues #304,
 * #306). Bulk folder downloads still ship every version — this is only the
 * single-file path.
 *
 * The sibling list is fetched the first time the section is expanded, matching
 * VariantMenuItems: a shelf of 200 books must not fire 200 requests for a menu
 * nobody opened.
 */
export default function DownloadVariantItems({ book, itemStyle, onPick }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { options, loading, load, label } = useVariantOptions('books', book.id, null)

  return (
    <>
      <button
        role="menuitem"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          load()
          setOpen((v) => !v)
        }}
        style={itemStyle}
      >
        <LuDownload size={15} aria-hidden="true" />
        {t('variants.downloadVersion')}
      </button>
      {open &&
        (loading ? (
          <div style={{ ...itemStyle, opacity: 0.6, cursor: 'default' }}>{t('common.loading')}</div>
        ) : (
          options.map((option) => (
            <a
              key={option.id}
              role="menuitem"
              href={mediaUrl(`/books/${option.id}/file`)}
              download
              onClick={(e) => {
                e.stopPropagation()
                onPick?.()
              }}
              style={{ ...itemStyle, paddingLeft: 30, fontSize: 13, textDecoration: 'none' }}
            >
              {label(option)}
            </a>
          ))
        ))}
    </>
  )
}
