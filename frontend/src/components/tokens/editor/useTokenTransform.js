import { useCallback, useMemo, useReducer } from 'react'

import { DEFAULT_TRANSFORM } from '../../../lib/tokenCompositor'

/**
 * The token's pan/zoom/rotate/flip state.
 *
 * Pure and DOM-free by design: the pointer hook turns events into these actions,
 * and the compositor turns the result into pixels, so all the arithmetic that
 * can actually be wrong lives here where jsdom can exercise it.
 */

export const MIN_SCALE = 0.2
export const MAX_SCALE = 8

export const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

/** Wrap into [0, 360) so the rotation readout never shows -270 or 450. */
export const wrapRotation = (deg) => ((deg % 360) + 360) % 360

/**
 * Keep the art from being dragged entirely out of the frame.
 *
 * Bounded to one output edge in each direction: far enough to put any corner of
 * the source under the mask, close enough that the user can never lose the image
 * off-canvas and be left staring at an empty token wondering what happened.
 */
export const clampOffset = (value, size) => {
  const limit = size || 0
  return Math.max(-limit, Math.min(limit, value))
}

function reducer(state, action) {
  const { size } = state
  switch (action.type) {
    case 'pan':
      return {
        ...state,
        offsetX: clampOffset(state.offsetX + action.dx, size),
        offsetY: clampOffset(state.offsetY + action.dy, size),
      }
    case 'setOffset':
      return {
        ...state,
        offsetX: clampOffset(action.x, size),
        offsetY: clampOffset(action.y, size),
      }
    case 'zoomBy':
      return { ...state, scale: clampScale(state.scale * action.factor) }
    case 'setScale':
      return { ...state, scale: clampScale(action.scale) }
    case 'zoomAt': {
      // Zoom toward a point: the art under the cursor should stay put, so the
      // offset absorbs the difference the scale change introduces. Offsets are
      // measured from the canvas centre, which is why the point is too.
      const scale = clampScale(state.scale * action.factor)
      if (scale === state.scale) return state
      const ratio = scale / state.scale
      return {
        ...state,
        scale,
        offsetX: clampOffset(action.x - (action.x - state.offsetX) * ratio, size),
        offsetY: clampOffset(action.y - (action.y - state.offsetY) * ratio, size),
      }
    }
    case 'rotate':
      return { ...state, rotation: wrapRotation(state.rotation + action.degrees) }
    case 'setRotation':
      return { ...state, rotation: wrapRotation(action.degrees) }
    case 'flipX':
      return { ...state, flipX: !state.flipX }
    case 'flipY':
      return { ...state, flipY: !state.flipY }
    case 'setSize':
      // The offset bound is expressed in output pixels, so a size change has to
      // re-clamp or a pan made at 1024 would survive illegally into 140.
      return {
        ...state,
        size: action.size,
        offsetX: clampOffset(state.offsetX, action.size),
        offsetY: clampOffset(state.offsetY, action.size),
      }
    case 'reset':
      return { ...DEFAULT_TRANSFORM, size: state.size }
    default:
      return state
  }
}

export default function useTokenTransform(size = 256) {
  const [state, dispatch] = useReducer(reducer, { ...DEFAULT_TRANSFORM, size })

  const actions = useMemo(
    () => ({
      pan: (dx, dy) => dispatch({ type: 'pan', dx, dy }),
      setOffset: (x, y) => dispatch({ type: 'setOffset', x, y }),
      zoomBy: (factor) => dispatch({ type: 'zoomBy', factor }),
      setScale: (scale) => dispatch({ type: 'setScale', scale }),
      zoomAt: (factor, x, y) => dispatch({ type: 'zoomAt', factor, x, y }),
      rotate: (degrees) => dispatch({ type: 'rotate', degrees }),
      setRotation: (degrees) => dispatch({ type: 'setRotation', degrees }),
      flipX: () => dispatch({ type: 'flipX' }),
      flipY: () => dispatch({ type: 'flipY' }),
      setSize: (next) => dispatch({ type: 'setSize', size: next }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    []
  )

  // What the compositor consumes — the size lives alongside but is not part of
  // the transform itself.
  const transform = useMemo(
    () => ({
      scale: state.scale,
      offsetX: state.offsetX,
      offsetY: state.offsetY,
      rotation: state.rotation,
      flipX: state.flipX,
      flipY: state.flipY,
    }),
    [state.scale, state.offsetX, state.offsetY, state.rotation, state.flipX, state.flipY]
  )

  const isDefault = useCallback(
    () =>
      transform.scale === DEFAULT_TRANSFORM.scale &&
      transform.offsetX === 0 &&
      transform.offsetY === 0 &&
      transform.rotation === 0 &&
      !transform.flipX &&
      !transform.flipY,
    [transform]
  )

  return { transform, size: state.size, isDefault, ...actions }
}
