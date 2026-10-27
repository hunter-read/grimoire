import { labelStyle } from './ui'

/** A labelled form control, laid out as a caption above its input. */
export default function Field({ label, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}
