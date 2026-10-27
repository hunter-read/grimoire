import type { ReactNode } from 'react'
import { LuCheck, LuTriangleAlert } from 'react-icons/lu'

interface Props {
  error?: ReactNode
  notice?: ReactNode
}

/**
 * The outcome of the last add-on action, shown where that action happened: a
 * refresh's under the shared buttons, an install's in its add-on's category.
 */
export default function AddonStatus({ error, notice }: Props) {
  if (!error && !notice) return null
  // A partial refresh can both succeed and report a source it could not reach.
  return (
    <>
      {notice && (
        <p
          role="status"
          style={{
            margin: '0 0 16px',
            fontSize: 13,
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <LuCheck size={14} color="var(--gold-dim)" />
          {notice}
        </p>
      )}
      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--danger, #c0392b)',
            background: 'var(--bg-deep)',
            padding: '10px 12px',
            borderRadius: 6,
            marginBottom: 16,
            border: '1px solid var(--danger, #c0392b)',
            wordBreak: 'break-word',
          }}
        >
          <LuTriangleAlert size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}
    </>
  )
}
