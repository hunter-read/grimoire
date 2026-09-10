import { useTranslation } from 'react-i18next'
import { LuGrid3X3 } from 'react-icons/lu'
import EnvironmentPanel from './EnvironmentPanel'
import LightProperties from './LightProperties'
import PortalProperties from './PortalProperties'
import { LAYER_STYLE } from './tools'
import { btnStyle, sectionTitleStyle } from './ui'

/**
 * The editor's right-hand panel: what exists, what is selected, and the
 * map-wide settings.
 *
 * Walls have no property panel because the format gives them no properties —
 * a wall run is only its points. Thickness, wall type, one-way behaviour and
 * "blocks movement but not sight" are all absent from `.uvtt`, so there is
 * nothing to edit and inventing controls would promise what export cannot keep.
 * Selected walls are therefore shown with their vertex count and a delete.
 */
export default function VttSidebar({
  doc,
  counts,
  dims,
  cellPx,
  selection,
  onSelect,
  onUpdateFeature,
  onDeleteFeature,
  onEnvironment,
  onRecalibrate,
}) {
  const { t } = useTranslation()

  const layers = [
    { key: 'line_of_sight', label: t('maps.vtt.layers.walls'), count: counts.line_of_sight },
    {
      key: 'objects_line_of_sight',
      label: t('maps.vtt.layers.objects'),
      count: counts.objects_line_of_sight,
    },
    { key: 'portals', label: t('maps.vtt.layers.portals'), count: counts.portals },
    { key: 'lights', label: t('maps.vtt.layers.lights'), count: counts.lights },
  ]

  const selected = selection ? doc[selection.key]?.[selection.index] : null

  return (
    <div
      style={{
        width: 290,
        flexShrink: 0,
        overflowY: 'auto',
        padding: 16,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}
    >
      <div style={sectionTitleStyle}>{t('maps.vtt.layers.title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {layers.map(({ key, label, count }) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              padding: '3px 0',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: LAYER_STYLE[key].stroke,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>{label}</span>
            <span style={{ color: 'var(--text-muted)' }} data-testid={`count-${key}`}>
              {count}
            </span>
          </div>
        ))}
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={sectionTitleStyle}>{t('maps.vtt.grid.title')}</div>
        <div style={{ fontSize: 13, marginBottom: 4 }}>
          {t('maps.vtt.grid.dimensions', { width: dims.width, height: dims.height })}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          {t('maps.vtt.grid.cellSize', { px: cellPx })}
        </div>
        <button type="button" onClick={onRecalibrate} style={btnStyle}>
          <LuGrid3X3 size={13} aria-hidden="true" /> {t('maps.vtt.grid.recalibrate')}
        </button>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={sectionTitleStyle}>{t('maps.vtt.selection.title')}</div>
        {!selected ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('maps.vtt.selection.none')}
          </div>
        ) : selection.key === 'lights' ? (
          <LightProperties
            light={selected}
            onChange={(v) => onUpdateFeature('lights', selection.index, v)}
            onDelete={() => onDeleteFeature('lights', selection.index)}
          />
        ) : selection.key === 'portals' ? (
          <PortalProperties
            portal={selected}
            onChange={(v) => onUpdateFeature('portals', selection.index, v)}
            onDelete={() => onDeleteFeature('portals', selection.index)}
          />
        ) : (
          <div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              {t('maps.vtt.selection.wall', { count: selected.length })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              {t('maps.vtt.selection.wallHint')}
            </div>
            <button
              type="button"
              onClick={() => onDeleteFeature(selection.key, selection.index)}
              style={btnStyle}
            >
              {t('maps.vtt.deleteSelected')}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        <EnvironmentPanel
          environment={doc.environment}
          lightCount={counts.lights}
          onChange={onEnvironment}
        />
      </div>
    </div>
  )
}
