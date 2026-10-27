import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLayers, LuPencil, LuTrash2 } from 'react-icons/lu'

import api, { duplicates, mediaUrl } from '../../api'
import type { Schema } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { formatSize } from '../../utils'
import { kindsFor } from '../../constants/variantKinds'
import variantLabel, { mainOption } from '../../utils/variantLabel'
import VariantDescribeForm from '../VariantDescribeForm'
import type { VariantDescribeFormProps } from '../VariantDescribeForm'

/**
 * Manage the versions filed under one book, from the book itself.
 *
 * Linking happens in the duplicate-review flow, but everything after it used to
 * be reachable only from there: an admin who linked a printer-friendly copy when
 * they meant black-and-white, or who wants the spreads cut to be the main
 * version, had no way back (issues #304, #306). This is that way back — change a
 * version's kind, promote it to main, unlink it, or delete the file. Any version
 * - the main one included - can also be renamed (issue #556).
 *
 * Admin-only, because every endpoint behind it is `require_admin`; a non-admin
 * gets the read-only list from the details modal instead of controls that would
 * 403 on click.
 */
export interface BookVersionsSectionProps {
  /** A list row (carrying `variant_count`) or a detail payload (carrying `variants`). */
  book: { id: string; variant_count?: number; variants?: Schema<'VariantEntry'>[] }
  /** After a change; given the new main version's id when it moved, else null. */
  onChanged?: (newMainId: string | null) => void
}

type BookFamily = Schema<'BookDetail'>

/** One row of the list: the main version or one of its variants. */
interface VersionEntry {
  id: string
  isMain?: boolean
  kind?: string
  label?: string
  filename?: string
  file_size?: number | null
  is_missing?: boolean
}

export default function BookVersionsSection({ book, onChanged }: BookVersionsSectionProps) {
  const { t } = useTranslation()
  const isAdmin = useAuth()?.user?.role === 'admin'
  const [family, setFamily] = useState<BookFamily | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  // A list row carries only the count; a detail payload carries the family
  // itself. Either way, a book with no other versions must not cost a request —
  // this section renders nothing for it.
  const hasVersions = (book.variant_count || 0) > 0 || (book.variants || []).length > 0

  const load = useCallback(() => {
    if (!hasVersions) return
    // Always re-fetch from the main entry so the list is the same whichever
    // member of the family the modal was opened from.
    api
      .get(`/books/${book.id}`)
      .then((data) => setFamily(data as BookFamily))
      .catch(() => setFamily(null))
  }, [book.id, hasVersions])

  useEffect(() => {
    load()
  }, [load])

  const mainId = family?.variant_main_id || family?.id
  const variants = family?.variants || []

  const run = async (fn: () => Promise<unknown>, newMainId: string | null = null) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      load()
      onChanged?.(newMainId)
    } catch (e) {
      setError((e as { message?: string } | null)?.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  if (!family || variants.length === 0) return null

  // `describe` rather than a re-link, so the version keeps its label.
  const changeKind = (entry: VersionEntry, kind: string) =>
    run(() => duplicates.describe('book', entry.id, { kind, label: entry.label || '' }))

  const makeMain = (variantId: string) =>
    run(
      () =>
        duplicates.promote('book', {
          newParentId: variantId,
          oldParentId: mainId as string,
          // The old main keeps its own description if it had one (it is still
          // the same file), else becomes a plain "version" of the new one; the
          // admin can refine that with the kind picker straight after.
          kind: family.variant_main_kind || 'version',
          label: family.variant_main_label || '',
        }),
      // Promoting changes which book is the row, and the new main may live in a
      // different category than the one it replaced, so the caller has to
      // refetch and follow the id rather than patch the row in place.
      variantId
    )

  const unlink = (variantId: string) => run(() => duplicates.unlink('book', { ids: [variantId] }))

  const remove = (variantId: string, deleteFile: boolean) =>
    run(async () => {
      await duplicates.deleteItem('book', variantId, { deleteFile })
      setConfirmDelete(null)
    })

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: '8px 0',
    borderTop: '1px solid var(--border)',
  }
  const btnStyle: CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  const main = mainOption(family)
  const entries: VersionEntry[] = [
    { ...main, file_size: family.file_size, is_missing: family.is_missing },
    ...variants,
  ]

  // Under the filename, so it never repeats it: the kind and label alone.
  const describeEntry = (entry: VersionEntry): string => {
    if (entry.isMain) return variantLabel(entry, t)
    const kindText = t(`variants.kind.${entry.kind}`, { defaultValue: entry.kind })
    return entry.label ? `${kindText} · ${entry.label}` : kindText
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        <LuLayers size={14} aria-hidden="true" />
        {t('variants.versionsHeading', { count: entries.length })}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>
          {error}
        </div>
      )}

      {entries.map((entry) => (
        <div key={entry.id} style={rowStyle}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 13, wordBreak: 'break-word' }}>
              {entry.filename}
              {entry.is_missing && (
                <span style={{ color: 'var(--danger)', marginLeft: 6, fontSize: 11 }}>
                  {t('variants.missing')}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {describeEntry(entry)}
              {entry.file_size ? ` · ${formatSize(entry.file_size)}` : ''}
            </div>
          </div>

          <a
            href={mediaUrl(`/books/${entry.id}/file`)}
            download
            style={{ ...btnStyle, textDecoration: 'none' }}
          >
            {t('common.download')}
          </a>

          {isAdmin && (
            <button
              type="button"
              disabled={busy}
              aria-label={t('variants.renameNamed', { name: describeEntry(entry) })}
              title={t('variants.rename')}
              onClick={() => setRenaming(renaming === entry.id ? null : entry.id)}
              style={btnStyle}
            >
              <LuPencil size={12} aria-hidden="true" />
            </button>
          )}

          {isAdmin && !entry.isMain && (
            <>
              <select
                aria-label={t('variants.changeKind')}
                value={entry.kind}
                disabled={busy}
                onChange={(e) => changeKind(entry, e.target.value)}
                style={{
                  background: 'var(--bg-card)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 12,
                }}
              >
                {/* Book kinds only — this section is mounted from the book
                    editor and details modal. `entry.kind` is passed so a
                    version filed under an older, unscoped vocabulary still
                    shows its own value instead of jumping to another. */}
                {kindsFor('book', entry.kind).map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`variants.kind.${kind}`, { defaultValue: kind })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => makeMain(entry.id)}
                style={btnStyle}
              >
                {t('variants.makeMain')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => unlink(entry.id)}
                style={btnStyle}
              >
                {t('variants.unlink')}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={t('variants.deleteVersion')}
                onClick={() => setConfirmDelete(entry.id)}
                style={{ ...btnStyle, color: 'var(--danger)' }}
              >
                <LuTrash2 size={12} aria-hidden="true" />
              </button>
            </>
          )}

          {renaming === entry.id && (
            <div style={{ flexBasis: '100%', padding: '4px 0' }}>
              <VariantDescribeForm
                // A variant carries no `isMain`; the form reads its absence as false.
                option={entry as VariantDescribeFormProps['option']}
                resourceType="book"
                onSaved={() => {
                  setRenaming(null)
                  load()
                  onChanged?.(null)
                }}
                onCancel={() => setRenaming(null)}
              />
            </div>
          )}

          {confirmDelete === entry.id && (
            <div
              style={{
                flexBasis: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                padding: '6px 0',
              }}
            >
              <span>{t('variants.deleteConfirm')}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(entry.id, true)}
                style={{ ...btnStyle, color: 'var(--danger)' }}
              >
                {t('variants.deleteFile')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(entry.id, false)}
                style={btnStyle}
              >
                {t('variants.deleteEntryOnly')}
              </button>
              <button type="button" onClick={() => setConfirmDelete(null)} style={btnStyle}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
