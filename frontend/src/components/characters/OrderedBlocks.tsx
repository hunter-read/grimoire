import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuGripVertical } from 'react-icons/lu'
import { mergeOrder, moveKey, renameInOrder, sortBlocks, storedOrder } from './sheetOrder'
import type { OrderBlock } from './sheetOrder'

interface Props {
  // The blocks in layout order.
  blocks: OrderBlock[]
  // The stored order: the text field's value, one key per line.
  stored: unknown
  className?: string
  // Writes the order to keep. Absent on a read-only sheet, which shows the
  // order without handles.
  onWrite?: (text: string) => void
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
export default function OrderedBlocks({ blocks: layoutBlocks, stored, className, onWrite }: Props) {
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
  // Which stored key each block stood for last time, so a row renamed - its
  // first column typed in - keeps its place rather than jumping to the top.
  const aliases = useRef(new Map<string, string>())
  const lastWritten = useRef<string | null>(null)

  const saved = storedOrder(stored)
  const renaming = renameInOrder(layoutBlocks, saved, aliases.current)
  const order = renaming.order
  const blocks = sortBlocks(layoutBlocks, order)
  const keys = blocks.map((block) => block.key)
  const orderRef = useRef(order)
  orderRef.current = order
  const onWriteRef = useRef(onWrite)
  onWriteRef.current = onWrite

  // The renamed key is written as soon as it is drawn, so the order still
  // knows the row when the sheet is opened again. Only the order field is
  // written, and every block keeps its React key, so the typing goes on.
  const renamedText = renaming.renamed ? mergeOrder(keys, order).join('\n') : null
  useEffect(() => {
    aliases.current = renaming.aliases
    if (renamedText === null || renamedText === stored || renamedText === lastWritten.current) {
      return
    }
    lastWritten.current = renamedText
    onWriteRef.current?.(renamedText)
  })

  const keysRef = useRef(keys)
  keysRef.current = keys

  useEffect(() => {
    if (!refocus.current) return
    const handle = handles.current.get(refocus.current)
    refocus.current = ''
    handle?.focus()
  })

  // A move writes the blocks drawn, in their new order, with the stored keys
  // of those not drawn now kept where they were.
  const commit = (next: string[]) => {
    const current = keysRef.current
    if (!next.some((key, index) => key !== current[index])) return
    const text = mergeOrder(next, orderRef.current).join('\n')
    lastWritten.current = text
    onWriteRef.current?.(text)
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
            key={block.id}
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
            {onWrite ? (
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
