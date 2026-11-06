import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronDown } from 'react-icons/lu'
import { toTitleCase } from '../../utils'

// More neighbours than this, and the list gets a filter box.
const FILTER_FROM = 8

interface Props {
  /** The folder whose neighbours these are, as shown ("Caverns"). */
  name: string
  /** The folder's own path, marked as the current one in the list. */
  path: string
  /** Every folder at the same level, as paths. */
  siblings: string[]
  hrefFor: (path: string) => string
}

/**
 * The ▾ beside a path-bar folder: the folders next to it, to step sideways
 * without going back up. A disclosure - a button and the list it shows - with a
 * filter box when the level is long. Escape or a click outside closes it and
 * returns focus to the button.
 */
export default function FolderSiblingMenu({ name, path, siblings, hrefFor }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return undefined
    filterRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (siblings.length < 2) return null
  const needle = query.trim().toLocaleLowerCase()
  const shown = siblings.filter(
    (p) => !needle || (p.split('/').pop() || p).toLocaleLowerCase().includes(needle)
  )

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('folderNav.siblings', { folder: name })}
        onClick={() => {
          setQuery('')
          setOpen((o) => !o)
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 24,
          minHeight: 24,
          padding: 0,
          borderRadius: 4,
          background: 'none',
          color: 'var(--text-muted)',
        }}
      >
        <LuChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            width: 260,
            padding: 6,
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--gold-dim)',
            boxShadow: '0 10px 26px var(--shadow)',
            overscrollBehavior: 'contain',
          }}
        >
          {siblings.length > FILTER_FROM && (
            <input
              ref={filterRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('folderNav.filterSiblings')}
              placeholder={t('folderNav.filterSiblings')}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: 4,
                padding: '5px 8px',
                fontSize: 13,
                borderRadius: 4,
                border: '1px solid var(--border-control)',
                background: 'var(--bg-input)',
              }}
            />
          )}
          <ul
            role="list"
            style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}
          >
            {shown.map((p) => {
              const here = p === path
              return (
                <li key={p}>
                  <Link
                    to={hrefFor(p)}
                    aria-current={here ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    style={{
                      display: 'block',
                      padding: '5px 8px',
                      borderRadius: 4,
                      fontSize: 14,
                      color: here ? 'var(--gold-bright)' : 'var(--text)',
                      background: here ? 'var(--bg-card-hover)' : undefined,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {toTitleCase(p.split('/').pop() || p)}
                  </Link>
                </li>
              )
            })}
            {shown.length === 0 && (
              <li style={{ padding: '5px 8px', fontSize: 13, color: 'var(--text-muted)' }}>
                {t('folderNav.noSiblingMatch')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
