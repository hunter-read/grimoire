import { useTranslation } from 'react-i18next'
import {
  LuDoorOpen,
  LuGrid3X3,
  LuLightbulb,
  LuMaximize,
  LuMousePointer2,
  LuMinus,
  LuPanelTop,
  LuRedo2,
  LuSquare,
  LuUndo2,
  LuZoomIn,
  LuZoomOut,
} from 'react-icons/lu'
import { TOOL_LIGHT, TOOL_OBJECT, TOOL_PORTAL, TOOL_SELECT, TOOL_WALL, TOOL_WINDOW } from './tools'
import { iconBtnStyle } from './ui'

/**
 * Tool selection, snapping, and view controls for the editor.
 *
 * Snap is a three-way choice rather than a checkbox: walls sit on grid
 * intersections most of the time, but a diagonal or a doorway that splits a
 * square needs half-cell steps, and an irregular cave wall needs none at all.
 * Forcing that into on/off would make one of those three cases impossible.
 */
export default function VttToolbar({
  tool,
  onTool,
  snap,
  onSnap,
  showGrid,
  onToggleGrid,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onFit,
}) {
  const { t } = useTranslation()

  const tools = [
    { id: TOOL_SELECT, icon: LuMousePointer2, label: t('maps.vtt.tools.select') },
    { id: TOOL_WALL, icon: LuMinus, label: t('maps.vtt.tools.wall') },
    { id: TOOL_OBJECT, icon: LuSquare, label: t('maps.vtt.tools.object') },
    { id: TOOL_PORTAL, icon: LuDoorOpen, label: t('maps.vtt.tools.portal') },
    // Its own button rather than a toggle on a placed door: the user knows
    // which they are drawing before the first click, and making them place a
    // door and then convert it was four steps to say one thing.
    { id: TOOL_WINDOW, icon: LuPanelTop, label: t('maps.vtt.tools.window') },
    { id: TOOL_LIGHT, icon: LuLightbulb, label: t('maps.vtt.tools.light') },
  ]

  const snaps = [
    { id: 'grid', label: t('maps.vtt.snap.grid') },
    { id: 'half', label: t('maps.vtt.snap.half') },
    { id: 'free', label: t('maps.vtt.snap.free') },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
      }}
    >
      <div style={{ display: 'flex', gap: 4 }} role="group" aria-label={t('maps.vtt.tools.title')}>
        {tools.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTool(id)}
            title={label}
            aria-label={label}
            aria-pressed={tool === id}
            style={{
              ...iconBtnStyle,
              padding: '5px 9px',
              borderColor: tool === id ? 'var(--gold)' : 'var(--border)',
              color: tool === id ? 'var(--gold)' : 'var(--text-dim)',
            }}
          >
            <Icon size={15} aria-hidden="true" />
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('maps.vtt.snap.title')}</span>
      <div style={{ display: 'flex', gap: 4 }} role="group" aria-label={t('maps.vtt.snap.title')}>
        {snaps.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSnap(id)}
            aria-pressed={snap === id}
            style={{
              ...iconBtnStyle,
              fontSize: 12,
              borderColor: snap === id ? 'var(--gold)' : 'var(--border)',
              color: snap === id ? 'var(--gold)' : 'var(--text-dim)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleGrid}
        title={t('maps.vtt.toggleGrid')}
        aria-label={t('maps.vtt.toggleGrid')}
        aria-pressed={showGrid}
        style={{
          ...iconBtnStyle,
          borderColor: showGrid ? 'var(--gold)' : 'var(--border)',
          color: showGrid ? 'var(--gold)' : 'var(--text-dim)',
        }}
      >
        <LuGrid3X3 size={15} aria-hidden="true" />
      </button>

      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title={t('maps.vtt.undo')}
        aria-label={t('maps.vtt.undo')}
        style={{ ...iconBtnStyle, opacity: canUndo ? 1 : 0.4 }}
      >
        <LuUndo2 size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title={t('maps.vtt.redo')}
        aria-label={t('maps.vtt.redo')}
        style={{ ...iconBtnStyle, opacity: canRedo ? 1 : 0.4 }}
      >
        <LuRedo2 size={15} aria-hidden="true" />
      </button>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={onZoomOut}
        style={iconBtnStyle}
        aria-label={t('maps.vtt.zoomOut')}
      >
        <LuZoomOut size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        style={iconBtnStyle}
        aria-label={t('maps.vtt.zoomIn')}
      >
        <LuZoomIn size={15} aria-hidden="true" />
      </button>
      <button type="button" onClick={onFit} style={iconBtnStyle} aria-label={t('maps.vtt.fit')}>
        <LuMaximize size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
