import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuCheck, LuChevronDown, LuPencil } from 'react-icons/lu'

import { useAuth } from '../context/AuthContext'
import variantLabel, { mainOption, variantFilename } from '../utils/variantLabel'
import VariantDescribeForm from './VariantDescribeForm'

/**
 * Switch between the versions of one item.
 *
 * A book, map, token, or audio track can collapse several files into one entry —
 * a printer-friendly cut, a gridless map, an older version (issues #304, #306).
 * Only the main entry appears in listings; this is how the others are reached.
 *
 * A button and a menu rather than a `<select>`: an `<option>` holds a single run
 * of text, which forced the filename into parentheses on the same line and made
 * a long one (`Universal VTT (No Water Night - Alchemy District.uvtt)`) unreadable
 * at a glance. A menu row can put the version's name on one line and its filename
 * underneath in smaller, dimmer text, which is what the download menu beside it
 * already does — so the two now match instead of diverging.
 *
 * Renders nothing when there is only one version, so callers can mount it
 * unconditionally rather than repeating the check at every call site.
 *
 * Given a `resourceType`, an admin can rename any version from the menu -
 * including the main one, which is otherwise always "Main version" (issue
 * #556). A saved name is applied here straight away rather than making every
 * detail view refetch the item for a menu label.
 */
export default function VariantPicker({ item, detailPath, resourceType, compact = false }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isAdmin = useAuth()?.user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [renamed, setRenamed] = useState({})
  const wrapRef = useRef(null)
  const canRename = isAdmin && !!resourceType

  const close = () => {
    setOpen(false)
    setEditing(null)
  }

  // Dismissal is wired the way every other menu in the app does it (the download
  // menu, the reader's ⋮, the campaign menus): mousedown outside, or Escape.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setEditing(null)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setEditing(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const siblings = item?.variants || []
  if (siblings.length === 0) return null

  // The family is (main entry + its variants); the main entry is not in
  // `variants`, so it is prepended here to make one flat list of choices.
  // The main entry comes from the `variant_main_*` fields: when this item is a
  // variant, its own row describes the variant, not the main.
  const options = [mainOption(item), ...siblings.map((v) => ({ ...v, isMain: false }))].map((o) =>
    renamed[o.id] ? { ...o, ...renamed[o.id] } : o
  )
  const current = options.find((o) => o.id === item.id)

  const choose = (id) => {
    close()
    if (id !== item.id) navigate(detailPath(id))
  }

  const fontSize = compact ? 12 : 13

  return (
    <span
      ref={wrapRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize,
        color: 'var(--text-dim)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          padding: '1px 6px',
          borderRadius: 8,
          color: 'var(--variant)',
          background: 'rgba(79,209,197,0.12)',
          border: '1px solid rgba(79,209,197,0.35)',
          fontWeight: 600,
        }}
      >
        {t('variants.badge', { count: options.length })}
      </span>
      <button
        type="button"
        aria-label={t('variants.switchLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          setEditing(null)
        }}
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          // The trigger shows only the version's name, never its filename: it
          // sits inline next to the title, and a long filename here is what
          // pushed the rest of the header off screen.
          maxWidth: 260,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? variantLabel(current, t) : t('variants.switchLabel')}
        </span>
        <LuChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 2000,
            minWidth: 220,
            maxWidth: 360,
            padding: '4px 0',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 20px var(--shadow)',
          }}
        >
          {options.map((option) => {
            const filename = variantFilename(option, t)
            const isCurrent = option.id === item.id
            const name = variantLabel(option, t)
            if (editing === option.id) {
              return (
                <div key={option.id} style={{ padding: '6px 12px' }}>
                  <VariantDescribeForm
                    option={option}
                    resourceType={resourceType}
                    onSaved={(desc) => {
                      setRenamed((prev) => ({ ...prev, [option.id]: desc }))
                      setEditing(null)
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )
            }
            const row = (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                aria-current={isCurrent || undefined}
                onClick={() => choose(option.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                  flex: 1,
                  minWidth: 0,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: isCurrent ? 'var(--bg-card)' : 'transparent',
                  color: 'var(--text)',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <LuCheck
                  size={12}
                  aria-hidden="true"
                  // Held in the layout rather than removed, so the rows stay
                  // aligned whichever one is current.
                  style={{ marginTop: 3, flexShrink: 0, opacity: isCurrent ? 1 : 0 }}
                />
                <span style={{ minWidth: 0 }}>
                  {name}
                  {filename && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        marginTop: 1,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {filename}
                    </span>
                  )}
                </span>
              </button>
            )
            if (!canRename) return row
            // A sibling of the menu item rather than inside it: a button
            // nested in a button is invalid, and would choose the row too.
            return (
              <div key={option.id} style={{ display: 'flex', alignItems: 'stretch' }}>
                {row}
                <button
                  type="button"
                  aria-label={t('variants.renameNamed', { name })}
                  title={t('variants.rename')}
                  onClick={() => setEditing(option.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    padding: '0 10px',
                    cursor: 'pointer',
                  }}
                >
                  <LuPencil size={12} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
