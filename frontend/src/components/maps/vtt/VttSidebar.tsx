import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuGrid3X3 } from 'react-icons/lu'
import EnvironmentPanel from './EnvironmentPanel'
import PreviewPanel from './PreviewPanel'
import SidebarSection from './SidebarSection'
import ToolHelp from './ToolHelp'
import LightProperties from './LightProperties'
import PortalProperties from './PortalProperties'
import { LAYER_STYLE } from './tools'
import { btnStyle } from './ui'

/**
 * The editor's right-hand panel: what is selected, what exists, and the
 * map-wide settings.
 *
 * Walls have no property panel because the format gives them no properties —
 * a wall run is only its points. Thickness, wall type, one-way behaviour and
 * "blocks movement but not sight" are all absent from `.uvtt`, so there is
 * nothing to edit and inventing controls would promise what export cannot keep.
 * Selected walls are therefore shown with their vertex count and a delete.
 *
 * **Order and collapsing both matter here.** Every section used to be expanded
 * at once, in the order they were written, which put Selection — the one block
 * that changes size constantly — in the middle of the panel. Selecting a light
 * grew it by a whole property form and shoved the player view and environment
 * settings down the panel with no animation to explain the jump.
 *
 * So: Selection sits at the top, where it is what you look at after clicking
 * something and where growing pushes only the static sections below it. The
 * reference material (tool help, layers, grid) is next and collapsed by
 * default once you are past needing it. Player view and Environment are
 * map-wide settings you configure occasionally, so they anchor the bottom.
 *
 * Open/closed state lives here rather than in the parent because nothing above
 * the sidebar cares which of its sections are folded away.
 */
export default function VttSidebar({
  doc,
  counts,
  dims,
  cellPx,
  tool,
  preview,
  onPreviewChange,
  selection,
  onSelect,
  onUpdateFeature,
  onDeleteFeature,
  onEnvironment,
  onRecalibrate,
}) {
  const { t } = useTranslation()

  // Defaults chosen so the panel opens showing what a user in the middle of
  // authoring needs: the selection and the gestures for the current tool.
  // Counts and grid are reference, consulted rarely and re-openable in a click.
  const [open, setOpen] = useState({
    selection: true,
    help: true,
    layers: false,
    grid: false,
    preview: false,
    environment: false,
  })
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  // Selecting something on the canvas must reveal its properties, or the click
  // appears to do nothing — placing a light already auto-selects it, and that
  // is worthless if the panel it lands in is folded shut.
  useEffect(() => {
    if (selection) setOpen((o) => (o.selection ? o : { ...o, selection: true }))
  }, [selection])

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

  // Every section after the first is separated by a rule, so a collapsed panel
  // still reads as a list of distinct things rather than a run of headings.
  const divider = { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }

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
      {/* Selection first: it is the answer to the click you just made, and
          putting the panel that grows at the top means it pushes only the
          static sections below rather than shifting things above it. */}
      <SidebarSection
        title={t('maps.vtt.selection.title')}
        open={open.selection}
        onToggle={() => toggle('selection')}
        data-testid="section-selection"
      >
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
      </SidebarSection>

      {/* Tool help: needed constantly while learning the gestures, and folded
          away for good once they are known. */}
      <div style={divider}>
        <SidebarSection
          title={t('maps.vtt.help.title')}
          open={open.help}
          onToggle={() => toggle('help')}
          data-testid="section-help"
        >
          <ToolHelp tool={tool} />
        </SidebarSection>
      </div>

      <div style={divider}>
        <SidebarSection
          title={t('maps.vtt.layers.title')}
          // The total stays visible when collapsed, so the section can still
          // answer "did that wall actually get added?" without expanding.
          count={
            counts.line_of_sight + counts.objects_line_of_sight + counts.portals + counts.lights
          }
          open={open.layers}
          onToggle={() => toggle('layers')}
          data-testid="section-layers"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        </SidebarSection>
      </div>

      <div style={divider}>
        <SidebarSection
          title={t('maps.vtt.grid.title')}
          open={open.grid}
          onToggle={() => toggle('grid')}
          data-testid="section-grid"
        >
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            {t('maps.vtt.grid.dimensions', { width: dims.width, height: dims.height })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            {t('maps.vtt.grid.cellSize', { px: cellPx })}
          </div>
          <button type="button" onClick={onRecalibrate} style={btnStyle}>
            <LuGrid3X3 size={13} aria-hidden="true" /> {t('maps.vtt.grid.recalibrate')}
          </button>
        </SidebarSection>
      </div>

      {/* The two map-wide settings anchor the bottom: they are configured
          occasionally rather than per-click, and neither belongs between the
          selection and the geometry it describes. */}
      <div style={divider}>
        <SidebarSection
          title={t('maps.vtt.preview.title')}
          open={open.preview}
          onToggle={() => toggle('preview')}
          data-testid="section-preview"
        >
          <PreviewPanel preview={preview} onChange={onPreviewChange} />
        </SidebarSection>
      </div>

      <div style={divider}>
        <SidebarSection
          title={t('maps.vtt.environment.title')}
          open={open.environment}
          onToggle={() => toggle('environment')}
          data-testid="section-environment"
        >
          <EnvironmentPanel
            environment={doc.environment}
            lightCount={counts.lights}
            onChange={onEnvironment}
          />
        </SidebarSection>
      </div>
    </div>
  )
}
