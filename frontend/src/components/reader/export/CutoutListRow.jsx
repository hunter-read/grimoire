import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import { pixelSize } from './cutoutGeometry'
import CutoutThumb from './CutoutThumb'
import { numberStyle } from './exportStyles'

/** One cut-out in the panel list: its picture, number, editable name and size. */
export default function CutoutListRow({
  cutout,
  number,
  active,
  defaultName,
  sizes,
  dpi,
  pageUrl,
  onSelect,
  onRename,
  onRemove,
}) {
  const { t } = useTranslation()
  const px = pixelSize(cutout, sizes, dpi)
  const shapeLabel = t(
    `pageExport.tool.${cutout.shape === 'ellipse' ? 'circle' : cutout.locked ? 'square' : 'rect'}`
  )

  return (
    <li
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 6,
        borderRadius: 8,
        cursor: 'pointer',
        background: active ? 'var(--bg-card-hover)' : 'transparent',
        border: `1px solid ${active ? 'var(--gold-dim)' : 'transparent'}`,
        transition: 'background 150ms ease-out, border-color 150ms ease-out',
      }}
    >
      {/* The number sits on the thumbnail's corner, as it sits on the box's
          corner on the page, so the two read as the same piece. */}
      <span style={{ position: 'relative', flexShrink: 0 }}>
        <CutoutThumb cutout={cutout} sizes={sizes} pageUrl={pageUrl} />
        <span
          aria-hidden="true"
          style={{
            ...numberStyle(active),
            position: 'absolute',
            top: -6,
            left: -6,
            boxShadow: '0 1px 3px var(--shadow)',
          }}
        >
          {number}
        </span>
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            value={cutout.name}
            placeholder={defaultName}
            title={cutout.name || defaultName}
            onChange={(e) => onRename(e.target.value)}
            onFocus={onSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('pageExport.nameLabel', { n: number })}
            maxLength={200}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '3px 6px',
              fontSize: 13,
              background: 'transparent',
              border: '1px solid transparent',
              borderRadius: 4,
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
          />
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            paddingLeft: 7,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {px
            ? t('pageExport.rowMeta', { shape: shapeLabel, width: px.width, height: px.height })
            : shapeLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={t('pageExport.remove', { n: number })}
        title={t('pageExport.remove', { n: number })}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex',
          padding: 4,
          borderRadius: 4,
        }}
      >
        <LuX size={14} />
      </button>
    </li>
  )
}
