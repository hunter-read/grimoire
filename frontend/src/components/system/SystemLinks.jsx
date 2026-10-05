import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuClipboard, LuExternalLink, LuChevronDown } from 'react-icons/lu'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'
import { collectSystemLinks, splitSystemLinks, linkText } from './systemLinkUtils'

const MENU_WIDTH = 260

const buttonStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 15,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--gold)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 220,
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

// A clipboard marks a character builder; an external-link arrow, a general link.
const linkIcon = (builder, size) => {
  const Icon = builder ? LuClipboard : LuExternalLink
  return <Icon size={size} aria-hidden="true" style={{ flexShrink: 0 }} />
}

/**
 * The game system's character builder and general links, shown in the header.
 *
 * Only a few are laid out as buttons (see `splitSystemLinks`). The rest go in a
 * "More" dropdown, grouped under a heading for each kind. Each kind has its own
 * icon (a clipboard for character builders, an external-link arrow for general
 * links), and a tooltip that names the kind, in both the buttons and the menu.
 */
export default function SystemLinks({ system }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { triggerRef, panelRef, style: menuStyle } = useAnchoredMenu(open, { width: MENU_WIDTH })

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerRef, panelRef])

  const links = collectSystemLinks(system)
  if (links.length === 0) return null
  const { visible, overflow } = splitSystemLinks(links)

  const text = (l) =>
    linkText(l, l.builder ? t('systemDetail.characterBuilder') : t('systemDetail.link'))
  const kindTitle = (l) =>
    l.builder
      ? t('systemDetail.characterBuilderTitle', { label: text(l) })
      : t('systemDetail.linkTitle', { label: text(l) })

  const groups = [
    { key: 'builders', heading: t('systemDetail.characterBuilders'), items: [] },
    { key: 'links', heading: t('systemDetail.links'), items: [] },
  ]
  overflow.forEach((l) => groups[l.builder ? 0 : 1].items.push(l))

  return (
    <div
      data-testid="system-links"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      {visible.map((l, i) => (
        <a
          key={`${l.url}-${i}`}
          href={l.url}
          target="_blank"
          rel="noopener"
          title={kindTitle(l)}
          aria-label={kindTitle(l)}
          data-kind={l.builder ? 'builder' : 'link'}
          style={buttonStyle}
        >
          {linkIcon(l.builder, 14)}
          <span style={ellipsis}>{text(l)}</span>
        </a>
      ))}

      {overflow.length > 0 && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('systemDetail.moreLinksTitle', { count: overflow.length })}
          title={t('systemDetail.moreLinksTitle', { count: overflow.length })}
          style={{ ...buttonStyle, cursor: 'pointer', font: 'inherit', fontSize: 15 }}
        >
          {t('systemDetail.moreLinks', { count: overflow.length })}
          <LuChevronDown size={14} aria-hidden="true" />
        </button>
      )}

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              ...menuStyle,
              zIndex: 2000,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
              overflowX: 'hidden',
            }}
          >
            {groups
              .filter((g) => g.items.length > 0)
              .map((g, gi) => (
                <div key={g.key} role="group" aria-label={g.heading}>
                  <div
                    aria-hidden="true"
                    style={{
                      padding: '8px 12px 4px',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      borderTop: gi > 0 ? '1px solid var(--border)' : 'none',
                      marginTop: gi > 0 ? 4 : 0,
                    }}
                  >
                    {g.heading}
                  </div>
                  {g.items.map((l, i) => (
                    <a
                      key={`${l.url}-${i}`}
                      role="menuitem"
                      href={l.url}
                      target="_blank"
                      rel="noopener"
                      title={kindTitle(l)}
                      data-kind={l.builder ? 'builder' : 'link'}
                      onClick={() => setOpen(false)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 12px',
                        fontSize: 13,
                        color: 'var(--text)',
                        textDecoration: 'none',
                      }}
                    >
                      {linkIcon(l.builder, 15)}
                      <span style={ellipsis}>{text(l)}</span>
                    </a>
                  ))}
                </div>
              ))}
          </div>,
          document.body
        )}
    </div>
  )
}
