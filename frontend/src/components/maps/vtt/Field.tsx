import type { CSSProperties, ReactNode } from 'react'
import { labelStyle } from './ui'

export interface FieldProps {
  label: ReactNode
  children?: ReactNode
  style?: CSSProperties
}

/** A labelled form control, laid out as a caption above its input. */
export default function Field({ label, children, style }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}
