import type { CSSProperties } from 'react'
import type { Schema } from '../../api'

/**
 * A portrait's framing: the focus point, as percentages across and down the
 * image, and a zoom from 1. Null or missing is centred and unzoomed.
 */
export type PortraitCrop = Schema<'PortraitCrop'>

export interface Framing {
  x: number
  y: number
  zoom: number
}

export const CENTRED: Framing = { x: 50, y: 50, zoom: 1 }
export const MAX_ZOOM = 4

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** A crop from the server, filled in and kept in range. */
export function framingOf(crop?: PortraitCrop | null): Framing {
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    x: clamp(number(crop?.x, CENTRED.x), 0, 100),
    y: clamp(number(crop?.y, CENTRED.y), 0, 100),
    zoom: clamp(number(crop?.zoom, CENTRED.zoom), 1, MAX_ZOOM),
  }
}

/**
 * Styles for an <img> filling its frame, framed as the player chose.
 *
 * `object-position` at the focus point lines that point of the image up with
 * the same point of the frame, whatever the frame's shape; scaling about the
 * same point then zooms without moving it. So one choice serves the square
 * header, the list's card and a tall panel on the sheet - which is what keeps
 * a full-length portrait's face in every one of them.
 */
export function framedImageStyle(crop?: PortraitCrop | null): CSSProperties {
  const { x, y, zoom } = framingOf(crop)
  const position = `${x}% ${y}%`
  return {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'cover',
    objectPosition: position,
    ...(zoom > 1 ? { transform: `scale(${zoom})`, transformOrigin: position } : {}),
  }
}
