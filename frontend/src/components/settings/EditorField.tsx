import { useId, type CSSProperties, type ReactNode } from 'react'

interface Props {
  label: ReactNode
  children?: ReactNode
}

/**
 * Labelled column used inside the expanded user editor grid.
 *
 * A group named by its caption, so a screen reader says "Role, group" on the
 * way into the control below it - the caption is a span, not a <label>,
 * because some columns hold more than one control.
 */
export default function EditorField({ label, children }: Props) {
  const labelId = useId()
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
    >
      <span id={labelId} style={fieldLabelStyle}>
        {label}
      </span>
      {children}
    </div>
  )
}

export const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
