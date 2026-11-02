import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuX,
  LuPlus,
  LuPencil,
  LuTrash2,
  LuChevronUp,
  LuChevronDown,
  LuCheck,
  LuFolder,
  LuLayers,
} from 'react-icons/lu'
import { campaigns, type Schema } from '../../api'
import Spinner from '../Spinner'
import useDialogFocus from '../../hooks/useDialogFocus'
import IconPicker from './IconPicker'

// Modal for managing a campaign's categories of a given kind ('note' | 'resource').
// Supports create, rename, reorder, and delete with two modes. When `typeGroups`
// is supplied (resource kind), the built-in type groups (Books/Maps/Tokens/Files)
// appear in the same orderable list so the whole panel order is GM-controlled;
// type groups can be moved but not renamed or deleted.
type Category = Schema<'CampaignCategoryOut'>
type CategoryKind = NonNullable<Parameters<typeof campaigns.listCategories>[1]>
type DeleteMode = Parameters<typeof campaigns.deleteCategory>[2]

/** What the per-category controls read: a category, or a category row. */
interface CatLike {
  id: string
  name: string
  icon?: string | null
  icon_color?: string | null
}

/** One row of the unified list: a category, or a built-in type group. */
interface GroupRow {
  key: string
  kind: 'cat' | 'type'
  id?: string
  name: string
  icon?: string | null
  icon_color?: string | null
  sort_order?: number | null
}

interface CategoryManagerProps {
  campaignId: string
  kind: CategoryKind
  typeGroups?: { key: string; label: string }[]
  groupOrder?: string[]
  onGroupOrderChange?: (orderedKeys: string[]) => void
  onClose: () => void
  onChanged?: () => void
}

export default function CategoryManager({
  campaignId,
  kind,
  typeGroups = [],
  groupOrder = [],
  onGroupOrderChange,
  onClose,
  onChanged,
}: CategoryManagerProps) {
  const { t } = useTranslation()
  const [cats, setCats] = useState<Category[] | null>(null)
  const [newName, setNewName] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, { onClose })
  // Said after an up/down move, since the row moving is only visible.
  const [moved, setMoved] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleting, setDeleting] = useState<CatLike | null>(null) // the category pending delete-mode choice
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The unified, ordered list of rows shown when type groups are included.
  const [rows, setRows] = useState<GroupRow[] | null>(null)

  const hasTypeGroups = typeGroups.length > 0

  // Merge categories + type groups into one ordered list using the saved group
  // order; unlisted groups fall to the end (categories before type groups).
  const buildRows = useCallback(
    (list: Category[]): GroupRow[] => {
      const catRows = list.map((c): GroupRow => ({
        key: `cat:${c.id}`,
        kind: 'cat',
        id: c.id,
        name: c.name,
        icon: c.icon,
        icon_color: c.icon_color,
        sort_order: c.sort_order,
      }))
      const typeRows = typeGroups.map((g): GroupRow => ({
        key: g.key,
        kind: 'type',
        name: g.label,
      }))
      const all = [...catRows, ...typeRows]
      const orderIndex = (key: string) => {
        const i = groupOrder.indexOf(key)
        return i === -1 ? groupOrder.length + all.findIndex((r) => r.key === key) : i
      }
      return [...all].sort((a, b) => orderIndex(a.key) - orderIndex(b.key))
    },
    [typeGroups, groupOrder]
  )

  const load = useCallback(() => {
    campaigns
      .listCategories(campaignId, kind)
      .then((list) => {
        // Every category the API returns carries a sort_order.
        const sorted = [...list].sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
        setCats(sorted)
        if (hasTypeGroups) setRows(buildRows(sorted))
      })
      .catch(() => {
        setCats([])
        if (hasTypeGroups) setRows(buildRows([]))
      })
    // buildRows is intentionally omitted: it changes with groupOrder on every
    // reorder, but load should only re-run when the campaign/kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, kind, hasTypeGroups])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError('')
    try {
      await campaigns.createCategory(campaignId, name, kind)
      setNewName('')
      load()
      onChanged?.()
    } catch (err) {
      setError((err as Error | undefined)?.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (id: string) => {
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    setError('')
    try {
      await campaigns.renameCategory(campaignId, id, name)
      setEditingId(null)
      load()
      onChanged?.()
    } catch (err) {
      setError((err as Error | undefined)?.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  // Patch a category's icon and/or tint, optimistically then on the server.
  const patchIcon = async (id: string, patch: { icon?: string; icon_color?: string }) => {
    setCats((prev) => prev!.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    if (hasTypeGroups) setRows((prev) => prev!.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    await campaigns.updateCategory(campaignId, id, patch)
    onChanged?.()
  }

  // Reorder in the unified (categories + type groups) list: persist the whole
  // group order, and also push category sort_order so the order is stable even
  // without a saved group order.
  const moveRow = async (index: number, dir: number) => {
    const next = [...rows!]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setRows(next)
    setMoved(
      t('a11y.campaignNotes.movedTo', {
        name: next[target].name,
        position: target + 1,
        total: next.length,
      })
    )
    const orderedKeys = next.map((r) => r.key)
    onGroupOrderChange?.(orderedKeys)
    await campaigns.setResourceGroupOrder(campaignId, orderedKeys)
    const catIds = next.filter((r) => r.kind === 'cat').map((r) => r.id!)
    if (catIds.length) await campaigns.reorderCategories(campaignId, catIds)
    onChanged?.()
  }

  // Reorder categories only (notes kind, or any kind without type groups).
  const move = async (index: number, dir: number) => {
    const next = [...cats!]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setCats(next)
    setMoved(
      t('a11y.campaignNotes.movedTo', {
        name: next[target].name,
        position: target + 1,
        total: next.length,
      })
    )
    await campaigns.reorderCategories(
      campaignId,
      next.map((c) => c.id)
    )
    onChanged?.()
  }

  const doDelete = async (mode: DeleteMode) => {
    setBusy(true)
    try {
      await campaigns.deleteCategory(campaignId, deleting!.id, mode)
      setDeleting(null)
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  // Up/down arrows for a row at `index` in a list of length `count`.
  const moveArrows = (
    index: number,
    count: number,
    onMove: (index: number, dir: number) => void,
    name?: string
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={() => onMove(index, -1)}
        disabled={index === 0}
        aria-label={`${t('campaignCategories.moveUp')}${name ? `: ${name}` : ''}`}
        style={arrowBtn(index === 0)}
      >
        <LuChevronUp size={13} />
      </button>
      <button
        onClick={() => onMove(index, 1)}
        disabled={index === count - 1}
        aria-label={`${t('campaignCategories.moveDown')}${name ? `: ${name}` : ''}`}
        style={arrowBtn(index === count - 1)}
      >
        <LuChevronDown size={13} />
      </button>
    </div>
  )

  // The editable name + edit/delete controls for a category row.
  const catControls = (c: CatLike) => (
    <>
      <IconPicker
        value={c.icon}
        onChange={(icon) => patchIcon(c.id, { icon: icon || '' })}
        color={c.icon_color}
        onColorChange={(color) => patchIcon(c.id, { icon_color: color || '' })}
        fallback={<LuFolder size={15} aria-hidden="true" />}
        ariaLabel={t('campaignCategories.iconLabel')}
      />
      {editingId === c.id ? (
        <input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename(c.id)
          }}
          // Esc cancels the rename only, not the whole dialog. Caught in the
          // capture phase: the dialog's own Esc listener (useDialogFocus) sits on
          // an ancestor and would otherwise hear it first and close.
          onKeyDownCapture={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            setEditingId(null)
          }}
          aria-label={t('a11y.campaignNotes.renameNamed', { name: c.name })}
          autoFocus
          style={{
            flex: 1,
            padding: '5px 8px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border-control)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: 13,
          }}
        />
      ) : (
        <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
      )}
      {editingId === c.id ? (
        <button
          onClick={() => rename(c.id)}
          aria-label={`${t('common.save')}: ${c.name}`}
          style={iconBtn}
        >
          <LuCheck size={14} color="var(--gold)" />
        </button>
      ) : (
        <button
          onClick={() => {
            setEditingId(c.id)
            setEditName(c.name)
          }}
          aria-label={`${t('common.edit')}: ${c.name}`}
          style={iconBtn}
        >
          <LuPencil size={13} />
        </button>
      )}
      <button
        onClick={() => setDeleting(c)}
        aria-label={`${t('common.delete')}: ${c.name}`}
        style={{ ...iconBtn, color: 'var(--danger)' }}
      >
        <LuTrash2 size={13} />
      </button>
    </>
  )

  const renderList = () => {
    const loading = cats === null || (hasTypeGroups && rows === null)
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
          <Spinner size={18} />
        </div>
      )
    }

    // Unified list: categories interleaved with built-in type groups.
    if (hasTypeGroups) {
      return (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows!.map((r, i) => (
            <li key={r.key} style={rowStyle}>
              {moveArrows(i, rows!.length, moveRow, r.name)}
              {r.kind === 'type' ? (
                <>
                  <LuLayers size={15} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                  <span style={{ flex: 1, fontSize: 14 }}>{r.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('campaignCategories.builtIn')}
                  </span>
                </>
              ) : (
                // A category row carries its category's id.
                catControls(r as CatLike)
              )}
            </li>
          ))}
        </ul>
      )
    }

    // Category-only list (notes, or resources without type groups).
    if (cats!.length === 0) {
      return (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 2px' }}>
          {t('campaignCategories.none')}
        </div>
      )
    }
    return (
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {cats!.map((c, i) => (
          <li key={c.id} style={rowStyle}>
            {moveArrows(i, cats!.length, move, c.name)}
            {catControls(c)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-manager-title"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 460,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>
        <h2
          id="category-manager-title"
          style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}
        >
          {kind === 'note'
            ? t('campaignCategories.titleNotes')
            : t('campaignCategories.titleResources')}
        </h2>
        <div role="status" className="sr-only">
          {moved}
        </div>

        {/* Create */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder={t('campaignCategories.newPlaceholder')}
            aria-label={t('campaignCategories.newPlaceholder')}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border-control)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
          <button onClick={create} disabled={busy || !newName.trim()} style={goldBtn}>
            <LuPlus size={14} /> {t('campaignCategories.add')}
          </button>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>
            {error}
          </p>
        )}

        <div style={{ overflowY: 'auto', flex: 1 }}>{renderList()}</div>

        {/* Delete-mode choice */}
        {deleting && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <div role="alert" style={{ fontSize: 13, marginBottom: 12 }}>
              {t('campaignCategories.deletePrompt', { name: deleting.name })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => doDelete('uncategorize')} disabled={busy} style={ghostBtn}>
                {t('campaignCategories.leaveUncategorized')}
              </button>
              <button
                onClick={() => doDelete('delete_items')}
                disabled={busy}
                style={{ ...ghostBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                {kind === 'note'
                  ? t('campaignCategories.deletePages')
                  : t('campaignCategories.unlinkResources')}
              </button>
              <button onClick={() => setDeleting(null)} style={ghostBtn}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 4px',
  borderBottom: '1px solid var(--border)',
}
const goldBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '8px 12px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
const ghostBtn: CSSProperties = {
  padding: '6px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 12,
}
const iconBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 4,
}
const arrowBtn = (disabled: boolean): CSSProperties => ({
  background: 'none',
  border: 'none',
  cursor: disabled ? 'default' : 'pointer',
  color: disabled ? 'var(--border)' : 'var(--text-muted)',
  display: 'flex',
  padding: 0,
})
