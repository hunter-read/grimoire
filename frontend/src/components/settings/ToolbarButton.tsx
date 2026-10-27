import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

interface Props {
  onClick?: MouseEventHandler<HTMLButtonElement>
  title?: string
  children?: ReactNode
}

const toolbarBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: 'none',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-dim)',
}

/** A single formatting button in the rich-text editor toolbar. */
export default function ToolbarButton({ onClick, title, children }: Props) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={toolbarBtnStyle}
    >
      {children}
    </button>
  )
}
