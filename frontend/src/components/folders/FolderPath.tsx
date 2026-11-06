import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import FolderSiblingMenu from './FolderSiblingMenu'
import { toTitleCase } from '../../utils'

interface Props {
  /** The collection's own name, the first step ("Maps"). */
  rootLabel: string
  /** The open folder's path ("Tom Cartos/Caverns"). */
  folder: string
  /** Every folder level in the collection, as paths. */
  allFolders: string[]
  /** The address of a folder, or of the whole collection for null. */
  hrefFor: (path: string | null) => string
}

const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

/**
 * The path bar of a gallery opened at a folder: Maps › Tom Cartos › Caverns.
 * Each step links back up; each folder's ▾ lists the folders beside it, so a
 * reader can step sideways (Caverns → Crypts) without climbing back.
 */
export default function FolderPath({ rootLabel, folder, allFolders, hrefFor }: Props) {
  const { t } = useTranslation()
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true }), [])
  const parts = folder.split('/')
  const siblingsOf = (path: string) => {
    const parent = parentOf(path)
    return allFolders
      .filter((p) => p !== '' && parentOf(p) === parent)
      .sort((a, b) => collator.compare(a, b))
  }

  return (
    <nav aria-label={t('folderNav.pathLabel')} style={{ marginBottom: 6 }}>
      <ol
        role="list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          fontSize: 14,
          color: 'var(--text-dim)',
        }}
      >
        <li>
          <Link to={hrefFor(null)} style={{ color: 'var(--text-dim)' }}>
            {rootLabel}
          </Link>
        </li>
        {parts.map((part, i) => {
          const path = parts.slice(0, i + 1).join('/')
          const name = toTitleCase(part)
          const last = i === parts.length - 1
          return (
            <li key={path} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', margin: '0 2px' }}>
                ›
              </span>
              {last ? (
                <span aria-current="page" style={{ color: 'var(--gold-bright)' }}>
                  {name}
                </span>
              ) : (
                <Link to={hrefFor(path)} style={{ color: 'var(--text-dim)' }}>
                  {name}
                </Link>
              )}
              <FolderSiblingMenu
                name={name}
                path={path}
                siblings={siblingsOf(path)}
                hrefFor={(p) => hrefFor(p)}
              />
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
