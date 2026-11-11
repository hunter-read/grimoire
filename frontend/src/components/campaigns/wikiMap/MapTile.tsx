import { useState, type CSSProperties } from 'react'
import { LuImage, LuMap } from 'react-icons/lu'
import LazyImg from '../../LazyImg'

interface MapTileProps {
  name: string
  subtitle?: string | null
  /** A small picture of the map; the kind's icon stands in until it loads, or if it can't. */
  src: string
  kind: 'map' | 'file'
  onClick: () => void
}

/**
 * One choice in the map picker: the map's picture over its name, so the GM can
 * tell maps apart by sight rather than by file name alone.
 */
export default function MapTile({ name, subtitle, src, kind, onClick }: MapTileProps) {
  const [failed, setFailed] = useState(false)
  const Icon = kind === 'map' ? LuMap : LuImage
  return (
    <button type="button" onClick={onClick} title={name} style={tile}>
      <span style={thumb}>
        {failed ? (
          <Icon
            size={22}
            aria-hidden="true"
            style={{ color: kind === 'map' ? 'var(--type-map)' : 'var(--type-file)' }}
          />
        ) : (
          <LazyImg
            src={src}
            alt=""
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </span>
      <span style={label}>{name}</span>
      {subtitle && <span style={sub}>{subtitle}</span>}
    </button>
  )
}

const tile: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
  padding: 6,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  color: 'var(--text)',
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
}

const thumb: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  aspectRatio: '4 / 3',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg-card)',
}

const ellipsis: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  padding: '0 2px',
}

const label: CSSProperties = { ...ellipsis, fontSize: 12, fontWeight: 500 }

const sub: CSSProperties = { ...ellipsis, fontSize: 11, color: 'var(--text-muted)' }
