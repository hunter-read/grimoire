import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuSave, LuTriangleAlert } from 'react-icons/lu'
import api, { mediaUrl } from '../../../api'
import Spinner from '../../Spinner'
import GridCalibrator from './GridCalibrator'
import VttCanvas from './VttCanvas'
import VttToolbar from './VttToolbar'
import VttSidebar from './VttSidebar'
import useVttDocument from './useVttDocument'
import { distance, distanceToPolyline, gridDimensions, round4 } from './geometry'
import {
  DEFAULT_LIGHT,
  POLYLINE_TOOLS,
  TOOL_LIGHT,
  TOOL_PORTAL,
  TOOL_SELECT,
  TOOL_WALL,
} from './tools'
import { btnStyle } from './ui'

/**
 * The Universal VTT map editor (issues #126 and #127).
 *
 * A full-screen route rather than an overlay on the detail view: calibration,
 * wall tracing and light placement all need room and a stable zoom, and the
 * detail pane is already competing with a sidebar and navigation arrows.
 *
 * The flow is deliberately two-phase. Grid calibration comes *first* and has to
 * be confirmed, because every coordinate stored afterwards is in grid units —
 * authoring against a wrong cell size does not merely look off, it silently
 * misplaces every wall and light in the exported file. Once confirmed, the user
 * can return to calibration from the sidebar, and doing so warns them, since
 * changing the cell size moves geometry already drawn.
 *
 * Nothing here writes to the library. Geometry is saved to the map row, and the
 * `.uvtt` itself is built on demand by the export endpoint and handed over as a
 * download — the user's own files are never modified and no sidecar appears
 * beside them.
 */
export default function VttEditorView() {
  const { mapId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [phase, setPhase] = useState('calibrate')
  const [cellPx, setCellPx] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const [tool, setTool] = useState(TOOL_WALL)
  const [snap, setSnap] = useState('grid')
  const [showGrid, setShowGrid] = useState(true)
  const [draft, setDraft] = useState({ points: [], cursor: null })
  const [selection, setSelection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const viewportRef = useRef(null)

  const { doc, docRef, update, undo, redo, reset, markSaved, dirty, counts, canUndo, canRedo } =
    useVttDocument(null)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/maps/${mapId}/vtt/authoring`)
      .then((d) => {
        if (cancelled) return
        setMeta(d)
        reset(d.data)
        // Seed the grid from what the map already resolves to, so the
        // calibration step opens showing the current best guess rather than a
        // blank overlay the user has to build from nothing.
        //
        // `cell_px` is not always present: a grid parsed from a "(30x40)" in
        // the filename knows the cell *counts* and nothing else. Dividing the
        // raster by that count recovers the cell size, which is the difference
        // between opening on a drawn grid and opening on no overlay at all.
        const px =
          d.data?.pixels_per_grid ||
          d.grid?.cell_px ||
          (d.grid?.width && d.pixel_width ? round4(d.pixel_width / d.grid.width) : 0)
        setCellPx(px)
        setOffset(d.data?.grid_offset || { x: 0, y: 0 })
        // A map that already carries authored geometry has had its grid
        // confirmed once; sending the user back through calibration every time
        // they reopen it would be busywork.
        if (d.data) setPhase('edit')
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [mapId, reset])

  const imageUrl = useMemo(() => mediaUrl(`/maps/${mapId}/page/1`, { width: 3000 }), [mapId])

  const cancelDraft = useCallback(() => setDraft({ points: [], cursor: null }), [])

  useEffect(() => {
    cancelDraft()
    setSelection(null)
  }, [tool, cancelDraft])

  /** Finish the polyline being drawn, if it has enough points to be a wall. */
  const commitPolyline = useCallback(() => {
    const key = tool === TOOL_WALL ? 'line_of_sight' : 'objects_line_of_sight'
    setDraft((d) => {
      if (d.points.length >= 2) {
        update((prev) => ({ ...prev, [key]: [...prev[key], d.points] }))
      }
      return { points: [], cursor: null }
    })
  }, [tool, update])

  /** Hit-test every feature and select the nearest within a tolerance. */
  const selectAt = useCallback(
    (pt) => {
      // Tolerance in grid units: a third of a cell is close enough to feel
      // forgiving without letting two adjacent walls fight over a click.
      const tol = 0.34
      let best = null
      for (const key of ['line_of_sight', 'objects_line_of_sight']) {
        docRef.current[key].forEach((line, index) => {
          const d = distanceToPolyline(pt, line)
          if (d < tol && (!best || d < best.d)) best = { key, index, d }
        })
      }
      docRef.current.portals.forEach((portal, index) => {
        const d = distanceToPolyline(pt, portal.bounds)
        if (d < tol && (!best || d < best.d)) best = { key: 'portals', index, d }
      })
      docRef.current.lights.forEach((light, index) => {
        const d = distance(pt, light.position)
        if (d < tol * 1.5 && (!best || d < best.d)) best = { key: 'lights', index, d }
      })
      setSelection(best ? { key: best.key, index: best.index } : null)
    },
    [docRef]
  )

  const handleClick = useCallback(
    (pt) => {
      if (tool === TOOL_SELECT) {
        selectAt(pt)
        return
      }
      if (tool === TOOL_LIGHT) {
        // Index the new light *before* the update: `update` writes docRef
        // synchronously, so reading the length afterwards would already count
        // the light just added and select one past the end.
        const index = docRef.current.lights.length
        update((prev) => ({
          ...prev,
          lights: [...prev.lights, { position: pt, ...DEFAULT_LIGHT }],
        }))
        // Select it so its properties are immediately editable — placing a
        // light is almost always followed by setting its range.
        setSelection({ key: 'lights', index })
        return
      }
      if (tool === TOOL_PORTAL) {
        setDraft((d) => {
          const points = [...d.points, pt]
          // A portal is exactly two points: the door line. The second click
          // completes it rather than extending a polyline.
          if (points.length === 2) {
            update((prev) => ({
              ...prev,
              portals: [...prev.portals, { bounds: points, closed: true, freestanding: false }],
            }))
            return { points: [], cursor: d.cursor }
          }
          return { ...d, points }
        })
        return
      }
      if (POLYLINE_TOOLS.has(tool)) {
        setDraft((d) => ({ ...d, points: [...d.points, pt] }))
      }
    },
    [tool, update, selectAt, docRef]
  )

  const handleDoubleClick = useCallback(() => {
    if (POLYLINE_TOOLS.has(tool)) commitPolyline()
  }, [tool, commitPolyline])

  // Keyboard: Escape ends or abandons the current shape, Enter finishes a wall,
  // Delete removes the selection, and Ctrl/Cmd+Z / +Shift+Z drive history.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') {
        cancelDraft()
        setSelection(null)
      } else if (e.key === 'Enter') {
        commitPolyline()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        e.preventDefault()
        update((prev) => ({
          ...prev,
          [selection.key]: prev[selection.key].filter((_, i) => i !== selection.index),
        }))
        setSelection(null)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelDraft, commitPolyline, selection, update, undo, redo])

  const save = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const current = docRef.current
      await api.put(`/maps/${mapId}/vtt/authoring`, {
        data: {
          // The grid the geometry was authored against travels with it:
          // everything stored is scale-relative, so without this a later grid
          // change or a replaced image would invalidate it undetectably.
          pixels_per_grid: cellPx,
          grid_offset: offset,
          line_of_sight: current.line_of_sight,
          objects_line_of_sight: current.objects_line_of_sight,
          portals: current.portals,
          lights: current.lights,
          environment: current.environment,
        },
      })
      markSaved()
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  // Warn on leaving with unsaved work. Authoring a dungeon's walls is many
  // minutes of effort and a stray back-navigation would discard all of it.
  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const goBack = () => {
    if (dirty && !window.confirm(t('maps.vtt.unsavedConfirm'))) return
    navigate(`/maps/${mapId}`)
  }

  if (loadError)
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {t('maps.vtt.loadFailed')}
      </div>
    )
  if (!meta)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const dims = gridDimensions(meta.pixel_width, meta.pixel_height, cellPx, offset)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={goBack}
          aria-label={t('maps.detail.back')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            fontSize: 15,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuArrowLeft size={15} aria-hidden="true" /> {t('common.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t('maps.vtt.title')}</span>
        <span
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.filename}
        </span>
        <div style={{ flex: 1 }} />
        {dirty && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('maps.vtt.unsaved')}</span>
        )}
        {saveError && (
          <span role="alert" style={{ fontSize: 12, color: 'var(--warning, #b7791f)' }}>
            <LuTriangleAlert size={13} aria-hidden="true" /> {t('maps.vtt.saveFailed')}
          </span>
        )}
        <button type="button" onClick={save} disabled={saving} style={btnStyle}>
          {saving ? <Spinner size={13} /> : <LuSave size={14} aria-hidden="true" />}{' '}
          {t('common.save')}
        </button>
        <a
          href={mediaUrl(`/maps/${mapId}/export.uvtt`)}
          style={{ ...btnStyle, textDecoration: 'none' }}
          title={t('maps.vtt.exportHint')}
        >
          <LuDownload size={14} aria-hidden="true" /> {t('maps.vtt.export')}
        </a>
      </div>

      {phase === 'calibrate' ? (
        <GridCalibrator
          imageUrl={imageUrl}
          pixelWidth={meta.pixel_width}
          pixelHeight={meta.pixel_height}
          cellPx={cellPx}
          offset={offset}
          onChange={(px, off) => {
            setCellPx(px)
            setOffset(off)
          }}
          onConfirm={() => setPhase('edit')}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <VttToolbar
            tool={tool}
            onTool={setTool}
            snap={snap}
            onSnap={setSnap}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((v) => !v)}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onZoomIn={() => viewportRef.current?.zoomBy(1.3)}
            onZoomOut={() => viewportRef.current?.zoomBy(1 / 1.3)}
            onFit={() => viewportRef.current?.fit()}
          />
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <VttCanvas
              imageUrl={imageUrl}
              pixelWidth={meta.pixel_width}
              pixelHeight={meta.pixel_height}
              cellPx={cellPx}
              offset={offset}
              doc={doc}
              tool={tool}
              snap={snap}
              showGrid={showGrid}
              draft={draft}
              selection={selection}
              onCanvasClick={handleClick}
              onCanvasDoubleClick={handleDoubleClick}
              onPointerMove={(pt) => setDraft((d) => ({ ...d, cursor: pt }))}
              viewportRef={viewportRef}
            />
            <VttSidebar
              doc={doc}
              counts={counts}
              dims={dims}
              cellPx={cellPx}
              selection={selection}
              onSelect={setSelection}
              onUpdateFeature={(key, index, value) =>
                update((prev) => ({
                  ...prev,
                  [key]: prev[key].map((item, i) => (i === index ? value : item)),
                }))
              }
              onDeleteFeature={(key, index) => {
                update((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }))
                setSelection(null)
              }}
              onEnvironment={(environment) => update((prev) => ({ ...prev, environment }))}
              onRecalibrate={() => {
                if (counts.line_of_sight + counts.lights + counts.portals > 0) {
                  if (!window.confirm(t('maps.vtt.recalibrateConfirm'))) return
                }
                setPhase('calibrate')
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
