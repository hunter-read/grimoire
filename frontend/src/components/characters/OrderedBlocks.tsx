import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuGripVertical } from 'react-icons/lu'
import { moveKey } from './sheetOrder'
import type { OrderBlock } from './sheetOrder'

interface Props {
  blocks: OrderBlock[]
  className?: string
  // Writes the new order, every block's key. Absent on a read-only sheet,
  // which shows the order without handles.
  onMove?: (keys: string[]) => void
}

interface Drag {
  key: string
  pointer: number
  // Where the block would land: before the block at this index, or at the end.
  target: number
}

/**
 * A `<g-order>`'s blocks, each with a handle the player drags it by - mouse,
 * pen or touch, through pointer events - or moves with the arrow keys once
 * it has focus. A move writes every block's key in the new order.
 *
 * While a block is dragged the blocks stay where they are, with a line where
 * it would land: moving them under the pointer would take the handle out of
 * the page and end the drag.
 */
export default function OrderedBlocks({ blocks, className, onMove }: Props) {
  const { t } = useTranslation()
  const [drag, setDragState] = useState<Drag | null>(null)
  // The drag as the window's listeners read it: state updaters run lazily, so
  // what to do on release is decided from this, never from inside one.
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (next: Drag | null) => {
    dragRef.current = next
    setDragState(next)
  }
  const elements = useRef(new Map<string, HTMLDivElement>())
  const handles = useRef(new Map<string, HTMLButtonElement>())
  // The handle to give focus back to once a keyboard move has redrawn the list.
  const refocus = useRef('')

  const keys = blocks.map((block) => block.key)
  const keysRef = useRef(keys)
  keysRef.current = keys
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  useEffect(() => {
    if (!refocus.current) return
    const handle = handles.current.get(refocus.current)
    refocus.current = ''
    handle?.focus()
  })

  const commit = (next: string[]) => {
    const current = keysRef.current
    if (next.some((key, index) => key !== current[index])) onMoveRef.current?.(next)
  }

  // Followed on the window, so the drag goes on wherever the pointer goes.
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return undefined
    const targetAt = (y: number) => {
      const current = keysRef.current
      for (let i = 0; i < current.length; i += 1) {
        const rect = elements.current.get(current[i])?.getBoundingClientRect()
        if (rect && y < rect.top + rect.height / 2) return i
      }
      return current.length
    }
    const move = (event: globalThis.PointerEvent) => {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointer) return
      const target = targetAt(event.clientY)
      if (target !== current.target) setDrag({ ...current, target })
    }
    const up = (event: globalThis.PointerEvent) => {
      const current = dragRef.current
      if (!current || event.pointerId !== current.pointer) return
      setDrag(null)
      const order = keysRef.current
      const from = order.indexOf(current.key)
      const target = targetAt(event.clientY)
      // Landing just after itself is landing where it was.
      if (from >= 0) commit(moveKey(order, from, target > from ? target - 1 : target))
    }
    const cancel = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [dragging])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!delta) return
    event.preventDefault()
    const from = keys.indexOf(key)
    const to = from + delta
    if (to < 0 || to >= keys.length) return
    refocus.current = key
    commit(moveKey(keys, from, to))
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, key: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    setDrag({ key, pointer: event.pointerId, target: keys.indexOf(key) })
  }

  const dropLine = '0 -2px 0 0 var(--gold)'
  return (
    <div className={['gc-order', className].filter(Boolean).join(' ')}>
      {blocks.map((block, index) => {
        const { key } = block
        const label = t('characters.orderMove', { position: index + 1, count: blocks.length })
        const before = drag !== null && drag.target === index
        const after = drag !== null && index === blocks.length - 1 && drag.target === blocks.length
        return (
          <div
            key={key}
            ref={(element) => {
              if (element) elements.current.set(key, element)
              else elements.current.delete(key)
            }}
            className={drag?.key === key ? 'gc-order-block gc-order-dragging' : 'gc-order-block'}
            data-order-key={key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 4,
              opacity: drag?.key === key ? 0.55 : undefined,
              boxShadow: before ? dropLine : after ? '0 2px 0 0 var(--gold)' : undefined,
            }}
          >
            {onMove ? (
              <button
                type="button"
                ref={(element) => {
                  if (element) handles.current.set(key, element)
                  else handles.current.delete(key)
                }}
                className="gc-order-handle"
                aria-label={label}
                title={label}
                onKeyDown={(event) => onKeyDown(event, key)}
                onPointerDown={(event) => onPointerDown(event, key)}
                style={{
                  touchAction: 'none',
                  cursor: drag?.key === key ? 'grabbing' : 'grab',
                  background: 'none',
                  border: 'none',
                  padding: 2,
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                }}
              >
                <LuGripVertical size={14} aria-hidden="true" />
              </button>
            ) : null}
            <div className="gc-order-content" style={{ flex: 1, minWidth: 0 }}>
              {block.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}
