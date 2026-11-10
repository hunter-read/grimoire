import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuEyeOff, LuMapPin } from 'react-icons/lu'
import { CampaignIcon } from '../campaignIcons'
import { resolveIconColor } from '../iconColors'
import { pinName, type WikiPin } from './mapPages'

interface MapPinMarkerProps {
  pin: WikiPin
  /** Where to draw it, as fractions of the map - the live spot while dragging. */
  x: number
  y: number
  /** The canvas zoom, undone on the marker so pins stay one size. */
  scale: number
  editing: boolean
  selected: boolean
  /** The target page's URL, or null for an unlinked pin. */
  href: string | null
  /** A click, which may cancel the link's navigation. */
  onSelect: (e: MouseEvent<HTMLElement>) => void
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
}

/**
 * One pin on a map page.
 *
 * Reading, a linked pin is a real link, so a click opens its page and a
 * middle or Ctrl/Cmd click opens it in a new tab. An unlinked pin, and every
 * pin while editing, is a button. Hovering or focusing one shows its name and
 * the page it opens.
 *
 * Kinds of pin are told apart by shape and glyph as well as colour: an
 * unlinked pin is hollow, and a GM-only one has a dashed rim and an eye-off
 * badge.
 */
export default function MapPinMarker({
  pin,
  x,
  y,
  scale,
  editing,
  selected,
  href,
  onSelect,
  onPointerDown,
  onKeyDown,
}: MapPinMarkerProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const name = pinName(pin)
  const gmOnly = pin.visibility === 'gm'
  const icon = pin.icon || pin.target_icon
  const tint = resolveIconColor(pin.icon ? pin.icon_color : pin.target_icon_color)
  const label = [
    name || t('wikiMap.unnamedPin'),
    pin.target_title && pin.target_title !== name ? pin.target_title : null,
    gmOnly ? t('wikiMap.gmOnly') : null,
    pin.target_page_id ? null : t('wikiMap.unlinked'),
  ]
    .filter(Boolean)
    .join(' - ')

  const style: CSSProperties = {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    // Centred on its spot, and kept one size whatever the zoom.
    transform: `translate(-50%, -50%) scale(${1 / scale})`,
    transformOrigin: '50% 50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    padding: 0,
    borderRadius: '50%',
    background: pin.target_page_id ? 'var(--bg-panel)' : 'transparent',
    border: `2px ${gmOnly ? 'dashed' : 'solid'} ${selected ? 'var(--gold)' : 'var(--text)'}`,
    boxShadow: selected ? '0 0 0 3px var(--gold)' : '0 2px 6px var(--overlay)',
    color: tint ?? 'var(--text)',
    cursor: editing ? 'grab' : 'pointer',
    touchAction: 'none',
    textDecoration: 'none',
    zIndex: selected || hovered ? 3 : 2,
  }
  const glyph = (
    <span style={{ display: 'inline-flex' }} aria-hidden="true">
      {icon ? <CampaignIcon name={icon} size={14} /> : <LuMapPin size={14} />}
    </span>
  )
  const extras = (
    <>
      {gmOnly && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            display: 'inline-flex',
            padding: 2,
            borderRadius: '50%',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
          }}
        >
          <LuEyeOff size={10} />
        </span>
      )}
      {hovered && (
        <span role="tooltip" style={tooltip}>
          {label}
        </span>
      )}
    </>
  )
  const common = {
    'aria-label': label,
    'aria-pressed': editing ? selected : undefined,
    'data-pin-id': pin.id,
    onPointerDown,
    onKeyDown,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
    style,
  }

  if (href && !editing) {
    return (
      <Link to={href} replace onClick={onSelect} {...common}>
        {glyph}
        {extras}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onSelect} {...common}>
      {glyph}
      {extras}
    </button>
  )
}

const tooltip: CSSProperties = {
  position: 'absolute',
  bottom: '120%',
  left: '50%',
  translate: '-50% 0',
  whiteSpace: 'nowrap',
  padding: '4px 8px',
  borderRadius: 6,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 12,
  pointerEvents: 'none',
  boxShadow: '0 2px 8px var(--overlay)',
}
