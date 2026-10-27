import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * The editor's document: walls, object walls, portals, lights, environment.
 *
 * Held as one immutable object with an undo/redo stack around it. A single
 * document rather than per-feature state because that is what the API stores
 * and what "save" means — one atomic replace — and because undo has to cross
 * feature boundaries: drawing a wall then a light then pressing undo twice must
 * unwind both, which separate states cannot express.
 *
 * Coordinates here are **grid units**, matching the file format, so saving is a
 * copy rather than a conversion. Pixel-space work happens in the canvas.
 */

export const EMPTY_DOC = {
  line_of_sight: [],
  objects_line_of_sight: [],
  portals: [],
  lights: [],
  environment: { baked_lighting: false, ambient_light: '00000000' },
}

// Deep enough for a long authoring session, bounded so a marathon session does
// not grow without limit.
const HISTORY_LIMIT = 100

/** The feature arrays, in the order the layer panel lists them. */
export const FEATURE_KEYS = ['line_of_sight', 'objects_line_of_sight', 'portals', 'lights']

export function normalizeDoc(raw) {
  if (!raw) return { ...EMPTY_DOC, environment: { ...EMPTY_DOC.environment } }
  return {
    line_of_sight: raw.line_of_sight || [],
    objects_line_of_sight: raw.objects_line_of_sight || [],
    portals: raw.portals || [],
    lights: raw.lights || [],
    environment: {
      baked_lighting: !!raw.environment?.baked_lighting,
      ambient_light: raw.environment?.ambient_light || '00000000',
    },
  }
}

export default function useVttDocument(initial) {
  const [doc, setDocState] = useState(() => normalizeDoc(initial))
  // Stacks live in refs: they are never rendered, and keeping them out of state
  // avoids re-rendering the canvas on every push.
  const undoStack = useRef([])
  const redoStack = useRef([])
  // Mirrors `doc` so callbacks can read the current value without depending on
  // it — otherwise every tool handler would be re-created on each edit.
  const docRef = useRef(doc)
  const [dirty, setDirty] = useState(false)
  // The stacks live in refs, so their depths are mirrored into state: without
  // this the undo/redo buttons would not re-enable until some other change
  // happened to re-render the toolbar.
  const [depths, setDepths] = useState({ undo: 0, redo: 0 })
  const syncDepths = useCallback(
    () => setDepths({ undo: undoStack.current.length, redo: redoStack.current.length }),
    []
  )

  const commit = useCallback(
    (next) => {
      const prev = docRef.current
      if (next === prev) return
      undoStack.current.push(prev)
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
      // Any new edit invalidates the redo branch, as in every editor.
      redoStack.current = []
      docRef.current = next
      setDocState(next)
      setDirty(true)
      syncDepths()
    },
    [syncDepths]
  )

  /** Apply a mutation described as `prev => next`. */
  const update = useCallback(
    (fn) => {
      commit(fn(docRef.current))
    },
    [commit]
  )

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (prev === undefined) return
    redoStack.current.push(docRef.current)
    docRef.current = prev
    setDocState(prev)
    setDirty(true)
    syncDepths()
  }, [syncDepths])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (next === undefined) return
    undoStack.current.push(docRef.current)
    docRef.current = next
    setDocState(next)
    setDirty(true)
    syncDepths()
  }, [syncDepths])

  /** Mark the current document as the saved baseline. */
  const markSaved = useCallback(() => setDirty(false), [])

  /** Replace the document wholesale — used when the editor (re)loads. */
  const reset = useCallback((raw) => {
    const next = normalizeDoc(raw)
    undoStack.current = []
    redoStack.current = []
    docRef.current = next
    setDocState(next)
    setDirty(false)
    setDepths({ undo: 0, redo: 0 })
  }, [])

  const counts = useMemo(
    () => ({
      line_of_sight: doc.line_of_sight.length,
      objects_line_of_sight: doc.objects_line_of_sight.length,
      portals: doc.portals.length,
      lights: doc.lights.length,
    }),
    [doc]
  )

  const isEmpty = useMemo(
    () =>
      FEATURE_KEYS.every((k) => doc[k].length === 0) &&
      !doc.environment.baked_lighting &&
      doc.environment.ambient_light === '00000000',
    [doc]
  )

  return {
    doc,
    docRef,
    update,
    undo,
    redo,
    reset,
    markSaved,
    dirty,
    counts,
    isEmpty,
    canUndo: depths.undo > 0,
    canRedo: depths.redo > 0,
  }
}
