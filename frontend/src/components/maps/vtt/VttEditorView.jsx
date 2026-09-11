import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuSave, LuTriangleAlert, LuUsers } from 'react-icons/lu'
import api, { campaigns as campaignsApi, mediaUrl } from '../../../api'
import { useAuth } from '../../../context/AuthContext'
import Spinner from '../../Spinner'
import GridCalibrator from './GridCalibrator'
import VttCanvas from './VttCanvas'
import VttToolbar from './VttToolbar'
import VttSidebar from './VttSidebar'
import useVttDocument from './useVttDocument'
import { distance, distanceToPolyline, gridDimensions, round4 } from './geometry'
import {
  DEFAULT_LIGHT,
  DEFAULT_PREVIEW,
  POLYLINE_TOOLS,
  PORTAL_CLOSED,
  PORTAL_TOOLS,
  TOOL_LIGHT,
  TOOL_SELECT,
  TOOL_WALL,
} from './tools'
import { btnStyle } from './ui'
import EditorHeader from './EditorHeader'
import VttSourcePicker from './VttSourcePicker'
import SendVttToCampaignDialog from './SendVttToCampaignDialog'
import {
  DEFAULT_PIXELS_PER_GRID,
  buildUvtt,
  encodeImageToBase64,
  guessCellPx,
  isUvttName,
  loadImageElement,
  readUvttFile,
} from '../../../lib/uvtt'

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
  // Defensive: `useAuth` returns null outside a provider, and the editor is
  // mounted in tests and (for a library map) needs nothing from it — only
  // the standalone campaign upload cares who the viewer is.
  const { user } = useAuth() || {}

  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [phase, setPhase] = useState('calibrate')
  const [cellPx, setCellPx] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const [tool, setTool] = useState(TOOL_WALL)
  // The player-view preview. Editor state only — a .uvtt cannot carry a token
  // or a viewing position, so none of this is saved or exported.
  const [preview, setPreview] = useState({ enabled: false, token: null, ...DEFAULT_PREVIEW })
  const [snap, setSnap] = useState('grid')
  const [showGrid, setShowGrid] = useState(true)
  const [draft, setDraft] = useState({ points: [], cursor: null })
  const [selection, setSelection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const viewportRef = useRef(null)

  // --- Standalone mode (no map row) ---------------------------------------
  // Everything the editor needs about a dropped file: the picture to draw on,
  // its dimensions, and the name to suggest when the result is downloaded.
  // Nothing is written to the library, exactly as the token editor does it —
  // a library mounted read-only must not be a reason this cannot be used.
  const [standalone, setStandalone] = useState(null)
  const [sourceError, setSourceError] = useState('')
  const [sending, setSending] = useState(false)
  const [choosingCampaign, setChoosingCampaign] = useState(false)
  const objectUrl = useRef(null)
  const imageRef = useRef(null)

  const { doc, docRef, update, undo, redo, reset, markSaved, dirty, counts, canUndo, canRedo } =
    useVttDocument(null)

  useEffect(() => {
    // Standalone: there is no map row to load from. The document arrives from
    // the dropped file instead, handled by `acceptFile` below.
    if (!mapId) return undefined
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

  // Where the picture comes from. A .uvtt's raster is base64 inside its
  // envelope, so the server names the endpoint that decodes it rather than the
  // page renderer, which would have nothing to render. A standalone file is
  // already an object/data URL held in state.
  const imageUrl = useMemo(() => {
    if (!mapId) return standalone?.imageUrl || null
    const path = meta?.image_url || `/maps/${mapId}/page/1`
    // Only the page renderer takes a width; the VTT decoder serves the
    // embedded image whole and an unknown query param would just be noise.
    return meta?.is_vtt ? mediaUrl(path) : mediaUrl(path, { width: 3000 })
  }, [mapId, meta, standalone])

  // Release the object URL for a dropped image when it is replaced or the
  // editor unmounts. A .uvtt produces a data: URL instead, which needs no
  // revoking, so the ref is simply null in that case.
  const releaseObjectUrl = useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])
  useEffect(() => releaseObjectUrl, [releaseObjectUrl])

  /**
   * Take a dropped or chosen file and open the editor on it.
   *
   * An image is a blank slate: calibration comes first, as it always does, and
   * the document starts empty. A `.uvtt` already carries geometry *and* states
   * its own cell size, so both are adopted and calibration is skipped — the
   * file has effectively already been calibrated, and re-confirming a grid the
   * file is certain about would be busywork before the user could touch a wall.
   */
  const acceptFile = useCallback(
    async (file) => {
      setSourceError('')
      releaseObjectUrl()
      try {
        if (isUvttName(file.name)) {
          const { imageUrl: url, doc: fileDoc, grid } = await readUvttFile(file)
          const image = await loadImageElement(url)
          imageRef.current = image
          reset(fileDoc)
          setCellPx(grid.pixelsPerGrid || guessCellPx(image.naturalWidth, grid.width))
          setOffset({ x: 0, y: 0 })
          setStandalone({
            imageUrl: url,
            filename: file.name,
            pixelWidth: image.naturalWidth,
            pixelHeight: image.naturalHeight,
          })
          setPhase('edit')
          return
        }
        const url = URL.createObjectURL(file)
        objectUrl.current = url
        const image = await loadImageElement(url)
        imageRef.current = image
        reset(null)
        // No grid is known for a bare picture, so open on the default cell size
        // and let calibration correct it. Everything stored afterwards is in
        // grid units, so this step cannot be skipped here.
        setCellPx(DEFAULT_PIXELS_PER_GRID)
        setOffset({ x: 0, y: 0 })
        setStandalone({
          imageUrl: url,
          filename: file.name,
          pixelWidth: image.naturalWidth,
          pixelHeight: image.naturalHeight,
        })
        setPhase('calibrate')
      } catch (err) {
        releaseObjectUrl()
        setStandalone(null)
        // The parse failures are worth naming: picking the wrong file is the
        // likeliest mistake, and "that file has no map in it" is actionable.
        const key = ['not-json', 'not-uvtt', 'no-image'].includes(err?.message)
          ? err.message
          : 'failed'
        setSourceError(t(`maps.vtt.source.error.${key}`))
      }
    },
    [releaseObjectUrl, reset, t]
  )

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
      if (PORTAL_TOOLS.has(tool)) {
        setDraft((d) => {
          const points = [...d.points, pt]
          // A portal is exactly two points: the door line. The second click
          // completes it rather than extending a polyline.
          if (points.length === 2) {
            update((prev) => ({
              ...prev,
              portals: [
                ...prev.portals,
                // The tool decides door vs window, so the kind is settled
                // before the first click rather than corrected afterwards.
                { bounds: points, closed: PORTAL_CLOSED[tool], freestanding: false },
              ],
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

  /**
   * Turn the preview on or off, seeding the token the first time.
   *
   * It starts at the middle of the map rather than at the origin: the top-left
   * corner of a battlemap is usually outside the playable area or buried in a
   * wall, and a token that appears somewhere sealed shows a black screen and
   * looks broken.
   */
  const togglePreview = useCallback(
    (next) => {
      setPreview((p) => ({
        ...p,
        ...next,
        token:
          next.token ??
          p.token ??
          (cellPx > 0
            ? {
                x: round4(meta ? meta.pixel_width / cellPx / 2 : 0),
                y: round4(meta ? meta.pixel_height / cellPx / 2 : 0),
              }
            : { x: 0, y: 0 }),
      }))
    },
    [cellPx, meta]
  )

  // Arrow keys nudge the token a square at a time, which is how a VTT moves
  // one. Shift takes a half step, for checking a sightline that a whole square
  // overshoots.
  const nudgeToken = useCallback((dx, dy) => {
    setPreview((p) =>
      p.token ? { ...p, token: { x: round4(p.token.x + dx), y: round4(p.token.y + dy) } } : p
    )
  }, [])

  // Keyboard: Escape ends or abandons the current shape, Enter finishes a wall,
  // Delete removes the selection, and Ctrl/Cmd+Z / +Shift+Z drive history.
  // While the preview is on, the arrow keys walk the token instead.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
      if (preview.enabled && preview.token && arrows[e.key]) {
        e.preventDefault()
        const step = e.shiftKey ? 0.5 : 1
        const [dx, dy] = arrows[e.key]
        nudgeToken(dx * step, dy * step)
        return
      }
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
  }, [
    cancelDraft,
    commitPolyline,
    selection,
    update,
    undo,
    redo,
    preview.enabled,
    preview.token,
    nudgeToken,
  ])

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

  /**
   * The finished `.uvtt` for a standalone map, as a Blob.
   *
   * The picture is re-encoded to WebP here for the same reason the server does
   * it: a dropped PNG is often many megabytes and base64 adds a third on top,
   * so passing the original through would hand the user a needlessly enormous
   * file. A `.uvtt` source is re-encoded too — its image came back through a
   * canvas either way, and one consistent path is worth more than saving a
   * re-encode on one branch.
   */
  const buildStandaloneBlob = useCallback(() => {
    const envelope = buildUvtt({
      imageBase64: encodeImageToBase64(imageRef.current),
      pixelWidth: standalone.pixelWidth,
      pixelHeight: standalone.pixelHeight,
      cellPx,
      doc: docRef.current,
    })
    return new Blob([JSON.stringify(envelope)], { type: 'application/octet-stream' })
  }, [standalone, cellPx, docRef])

  /** The name to save under: the source's, with a .uvtt extension. */
  const exportName = useCallback(() => {
    const stem = (standalone?.filename || 'map').replace(/\.[^.]+$/, '')
    return `${stem || 'map'}.uvtt`
  }, [standalone])

  const downloadStandalone = () => {
    setSaveError(false)
    try {
      const url = URL.createObjectURL(buildStandaloneBlob())
      const a = document.createElement('a')
      a.href = url
      a.download = exportName()
      a.click()
      // Revoked on a later tick: revoking synchronously can race the browser's
      // own fetch of the blob and produce an empty download.
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      markSaved()
    } catch {
      setSaveError(true)
    }
  }

  /**
   * Send the finished file into a campaign as a linked resource.
   *
   * The upload endpoint files it under the chosen category in the same call,
   * so the map lands where the GM expects rather than loose at the bottom of
   * the resource list.
   */
  const sendToCampaign = async ({ campaignId, categoryId }) => {
    setSending(true)
    setSaveError(false)
    try {
      const file = new File([buildStandaloneBlob()], exportName(), {
        type: 'application/octet-stream',
      })
      await campaignsApi.uploadFile(campaignId, file, categoryId ? { categoryId } : {})
      markSaved()
      setChoosingCampaign(false)
      navigate(`/campaigns/${campaignId}`)
    } catch {
      setSaveError(true)
    } finally {
      setSending(false)
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
    navigate(mapId ? `/maps/${mapId}` : '/maps')
  }

  if (loadError)
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {t('maps.vtt.loadFailed')}
      </div>
    )

  // Standalone with nothing chosen yet: the picker is the whole page, exactly
  // as the token editor's source step is.
  if (!mapId && !standalone)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <EditorHeader
          title={t('maps.vtt.title')}
          subtitle={t('maps.vtt.source.subtitle')}
          onBack={goBack}
          backLabel={t('common.back')}
          backAria={t('maps.detail.back')}
        />
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <VttSourcePicker onFile={acceptFile} error={sourceError} />
        </div>
      </div>
    )

  if (mapId && !meta)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  // One shape for both modes, so everything below reads from a single source
  // rather than branching on `mapId` at every use.
  const source = mapId
    ? { filename: meta.filename, pixelWidth: meta.pixel_width, pixelHeight: meta.pixel_height }
    : {
        filename: standalone.filename,
        pixelWidth: standalone.pixelWidth,
        pixelHeight: standalone.pixelHeight,
      }

  const dims = gridDimensions(source.pixelWidth, source.pixelHeight, cellPx, offset)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <EditorHeader
        title={t('maps.vtt.title')}
        subtitle={source.filename}
        onBack={goBack}
        backLabel={t('common.back')}
        backAria={t('maps.detail.back')}
      >
        {dirty && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('maps.vtt.unsaved')}</span>
        )}
        {saveError && (
          <span role="alert" style={{ fontSize: 12, color: 'var(--warning, #b7791f)' }}>
            <LuTriangleAlert size={13} aria-hidden="true" /> {t('maps.vtt.saveFailed')}
          </span>
        )}
        {/* A library map saves its geometry to the map row and exports through
            the server. A standalone one has no row to save to, so its exits are
            the two the token editor established: download it, or send it to a
            campaign. */}
        {mapId ? (
          <>
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
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setChoosingCampaign(true)}
              disabled={sending}
              style={btnStyle}
              title={t('maps.vtt.send.hint')}
            >
              <LuUsers size={14} aria-hidden="true" /> {t('maps.vtt.send.button')}
            </button>
            <button
              type="button"
              onClick={downloadStandalone}
              style={btnStyle}
              title={t('maps.vtt.exportHint')}
            >
              <LuDownload size={14} aria-hidden="true" /> {t('maps.vtt.export')}
            </button>
          </>
        )}
      </EditorHeader>

      {phase === 'calibrate' ? (
        <GridCalibrator
          imageUrl={imageUrl}
          pixelWidth={source.pixelWidth}
          pixelHeight={source.pixelHeight}
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
              pixelWidth={source.pixelWidth}
              pixelHeight={source.pixelHeight}
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
              onPointerMove={(pt, free) => setDraft((d) => ({ ...d, cursor: pt, free }))}
              preview={preview}
              onTokenMove={(token) => setPreview((p) => ({ ...p, token }))}
              viewportRef={viewportRef}
            />
            <VttSidebar
              doc={doc}
              counts={counts}
              dims={dims}
              cellPx={cellPx}
              tool={tool}
              preview={preview}
              onPreviewChange={togglePreview}
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

      {choosingCampaign && (
        <SendVttToCampaignDialog
          userId={user?.id}
          busy={sending}
          onClose={() => setChoosingCampaign(false)}
          onChoose={sendToCampaign}
        />
      )}
    </div>
  )
}
