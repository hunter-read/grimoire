import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLayers, LuPencil, LuTrash2 } from 'react-icons/lu'

import api, { duplicates, mediaUrl } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { formatSize } from '../../utils'
import { kindsFor } from '../../constants/variantKinds'
import variantLabel, { mainOption } from '../../utils/variantLabel'
import VariantDescribeForm from '../VariantDescribeForm'

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
export default function BookVersionsSection({ book, onChanged }) {
  const { t } = useTranslation()
  const isAdmin = useAuth()?.user?.role === 'admin'
  const [family, setFamily] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [renaming, setRenaming] = useState(null)

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
      .then((data) => setFamily(data))
      .catch(() => setFamily(null))
  }, [book.id, hasVersions])

  useEffect(() => {
    load()
  }, [load])

  const mainId = family?.variant_main_id || family?.id
  const variants = family?.variants || []

  const run = async (fn, newMainId = null) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      load()
      onChanged?.(newMainId)
    } catch (e) {
      setError(e?.message || t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  if (!family || variants.length === 0) return null

  // `describe` rather than a re-link, so the version keeps its label.
  const changeKind = (entry, kind) =>
    run(() => duplicates.describe('book', entry.id, { kind, label: entry.label || '' }))

  const makeMain = (variantId) =>
    run(
      () =>
        duplicates.promote('book', {
          newParentId: variantId,
          oldParentId: mainId,
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

  const unlink = (variantId) => run(() => duplicates.unlink('book', { ids: [variantId] }))

  const remove = (variantId, deleteFile) =>
    run(async () => {
      await duplicates.deleteItem('book', variantId, { deleteFile })
      setConfirmDelete(null)
    })

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: '8px 0',
    borderTop: '1px solid var(--border)',
  }
  const btnStyle = {
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
  const entries = [
    { ...main, file_size: family.file_size, is_missing: family.is_missing },
    ...variants,
  ]

  // Under the filename, so it never repeats it: the kind and label alone.
  const describeEntry = (entry) => {
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
                option={entry}
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
