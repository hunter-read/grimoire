import { isValidElement, type CSSProperties, type ReactNode } from 'react'

/** A heading that keeps the look of the toggle button inside it. */
export const plainHeading: CSSProperties = {
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  letterSpacing: 'normal',
}

export interface ItemListProps {
  /** One rendered card per item; a null (an item merged away) is left out. */
  nodes: ReactNode[]
  style?: CSSProperties
}

/**
 * The tagged items of a section or folder as a real list, so a screen reader
 * says how many there are and where each one sits. Each card keeps its own key
 * (the item id) on the list item that wraps it.
 */
export default function ItemList({ nodes, style }: ItemListProps) {
  return (
    <ul role="list" className="card-list" style={style}>
      {nodes
        .filter((node) => node !== null && node !== undefined && node !== false)
        .map((node, i) => (
          <li key={isValidElement(node) && node.key != null ? node.key : i}>{node}</li>
        ))}
    </ul>
  )
}
