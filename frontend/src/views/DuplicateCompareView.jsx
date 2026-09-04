import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { LuArrowLeft, LuArrowLeftRight, LuLayers, LuTrash2, LuX } from 'react-icons/lu'

import { duplicates as dupesApi } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import { kindsFor } from '../constants/variantKinds'
import PagePreview from '../components/duplicates/PagePreview'
import RefCounts from '../components/duplicates/RefCounts'
import PageFlipper from '../components/duplicates/PageFlipper'
import DiffTable from '../components/duplicates/DiffTable'
import ConfirmDelete from '../components/duplicates/ConfirmDelete'
import MetadataCopyPanel from '../components/duplicates/MetadataCopyPanel'
import VariantFamilyNotice from '../components/duplicates/VariantFamilyNotice'

function formatSize(bytes) {
  if (!bytes) return '—'
  const mb = bytes / 1048576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Two copies side by side, and every decision a user can make about them.
 *
 * Reviewing duplicates is a comparison task, and the group card could not
 * support it: it listed members in one column with one verdict for the whole
 * set. Here the two files sit in matching columns so the eye can track a
 * difference across them, and each decision is expressed per pair — which one is
 * the parent, what kind the other one is, and whether they are related at all.
 *
 * Pairs rather than groups because a five-member group is more than a person can
 * hold at once, and one verdict over five files cannot say "these match but that
 * one does not" (see `utils/duplicatePairs`).
 */
export default function DuplicateCompareView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { resourceType } = useParams()
  const [params] = useSearchParams()
  const leftId = params.get('left') || ''
  const rightId = params.get('right') || ''

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  // Which side is the parent. Seeded from the server's advisory pick, then
  // entirely the user's call — the scan's guess is often wrong about which copy
  // someone actually wants to keep.
  const [parentId, setParentId] = useState('')
  const [kind, setKind] = useState('other')
  const [label, setLabel] = useState('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState(null)
  // Default on: someone resolving duplicates has decided this copy is
  // redundant, and leaving the bytes behind means the next scan proposes the
  // same pair again.
  const [deleteFile, setDeleteFile] = useState(true)

  useEffect(() => {
    if (!isAdmin || !leftId || !rightId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    dupesApi
      .compare(resourceType, [leftId, rightId])
      .then((res) => {
        if (cancelled) return
        setData(res)
        setParentId(res.suggested_parent_id || leftId)
        setError(null)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || t('maintenance.dupes.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `t` is deliberately excluded: it changes identity on every language
    // switch and would re-fetch the comparison for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, resourceType, leftId, rightId])

  const items = useMemo(() => data?.items || [], [data])
  const left = items.find((i) => i.id === leftId) || items[0]
  const right = items.find((i) => i.id === rightId) || items[1]
  const childId = left && right ? (parentId === left.id ? right.id : left.id) : ''

  const back = useCallback(() => navigate('/settings/duplicates'), [navigate])

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn()
      back()
    } catch (e) {
      setError(e.message || t('maintenance.dupes.actionFailed'))
      setBusy(false)
    }
  }

  // The copy being demoted may already be the main version of its own family —
  // the user linked it earlier, then met a third copy they consider the real
  // edition. Plain `link` refuses that, so its whole family moves at once
  // instead. Anything else is an ordinary link.
  const childItem = childId === left?.id ? left : right
  const parentItem = parentId === left?.id ? left : right
  const childHasFamily = (childItem?.variants || []).length > 0
  // The other dead end: the copy being demoted is a variant of some *third*
  // item. Both link and promote refuse it, because filing it here would stack a
  // third level. The whole family has to move instead, which means promoting
  // over its main version rather than over the copy in front of us.
  const childsMain = childItem?.variant_main || null

  // Only the kinds this collection accepts: a token has no gridless cut, and an
  // audio track cannot be form-fillable. The child's stored kind is passed so a
  // row linked before the vocabulary was scoped keeps its value in the list
  // rather than being silently re-filed on the next save.
  const kindOptions = useMemo(
    () => kindsFor(resourceType, childItem?.variant_kind || ''),
    [resourceType, childItem?.variant_kind]
  )

  // `kind` is seeded to `other`, which every collection accepts, but the user
  // may have picked one and then flipped which side is the parent. Snap back to
  // a valid choice rather than submitting one the API will reject.
  useEffect(() => {
    if (!kindOptions.includes(kind)) setKind('other')
  }, [kindOptions, kind])

  const copyMetadata = async (fields) => {
    setBusy(true)
    try {
      // Source is the copy being discarded, target the one being kept: the
      // point is to rescue curated metadata before the other row goes away.
      await dupesApi.mergeMetadata({
        resource_type: resourceType,
        source_id: childId,
        target_id: parentId,
        fields,
        overwrite: true,
      })
      const fresh = await dupesApi.compare(resourceType, [leftId, rightId])
      setData(fresh)
      setError(null)
    } catch (e) {
      setError(e.message || t('maintenance.dupes.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  const linkPair = () =>
    act(() =>
      childHasFamily
        ? dupesApi.promote(resourceType, {
            newParentId: parentId,
            oldParentId: childId,
            kind,
            label,
          })
        : dupesApi.link(resourceType, parentId, [{ id: childId, kind, label }])
    )

  // One promote against the family the child already belongs to: its main
  // version becomes a variant of the copy being kept, and everything under it —
  // the child included — re-homes there. This is the operation the refusal
  // message was describing; the user just had no way to reach it.
  const promoteOverFamily = () =>
    act(() =>
      dupesApi.promote(resourceType, {
        newParentId: parentId,
        oldParentId: childsMain.id,
        kind,
        label,
      })
    )

  // Same keeper, but paired against the main version instead — the comparison
  // the promote actually applies to, for a user who would rather look before
  // moving a whole family.
  const compareWithMain = () =>
    navigate(
      `/settings/duplicates/compare/${resourceType}` +
        `?left=${encodeURIComponent(parentId)}&right=${encodeURIComponent(childsMain.id)}`
    )

  const dismissPair = () => act(() => dupesApi.dismiss(resourceType, [leftId, rightId]))

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        {t('maintenance.dupes.adminOnly')}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={20} />
      </div>
    )
  }

  if (!left || !right) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        <div style={{ marginBottom: 12 }}>{error || t('maintenance.dupes.loadFailed')}</div>
        <button onClick={back} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('maintenance.dupes.backToList')}
        </button>
      </div>
    )
  }

  const maxPage = data?.page_count_min || 0

  return (
    <div
      style={{
        padding: '16px 24px 40px',
        maxWidth: 1600,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <button onClick={back} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('maintenance.dupes.backToList')}
        </button>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>
        {t('maintenance.dupes.compareTitle')}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.dupes.compareDescription')}
      </p>

      {error && (
        <div style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
      )}

      {/* The two copies, in matching columns so a difference lines up
          horizontally and the eye can track it across. */}
      <div
        style={{
          display: 'grid',
          // Wide minimum: two readable pages side by side is the whole
          // point, so the columns stack only when they genuinely cannot fit.
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        {[left, right].map((item) => {
          const isParent = item.id === parentId
          return (
            <div
              key={item.id}
              style={{
                border: `1px solid ${isParent ? 'var(--variant)' : 'var(--border)'}`,
                borderRadius: 8,
                padding: 14,
                background: isParent ? 'rgba(79,209,197,0.06)' : 'var(--bg-card)',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  marginBottom: 10,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="parent"
                  checked={isParent}
                  onChange={() => setParentId(item.id)}
                />
                {isParent ? t('maintenance.dupes.isParent') : t('maintenance.dupes.makeParent')}
              </label>

              <PagePreview resourceType={resourceType} item={item} page={page} />

              <div style={{ fontSize: 14, wordBreak: 'break-word', marginTop: 10 }}>
                {item.title || item.filename}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                {item.relative_path}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {formatSize(item.file_size)}
                {item.page_count ? ` · ${item.page_count}p` : ''}
                {item.game_system_name ? ` · ${item.game_system_name}` : ''}
              </div>
              <RefCounts counts={item.reference_counts} />
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(item.id)}
                style={{
                  marginTop: 10,
                  background: 'transparent',
                  border: '1px solid rgba(180,60,60,0.4)',
                  color: 'var(--danger)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <LuTrash2 size={12} aria-hidden="true" /> {t('maintenance.dupes.deleteThis')}
              </button>
            </div>
          )
        })}
      </div>

      {maxPage > 1 && <PageFlipper page={page} maxPage={maxPage} onChange={setPage} />}

      <DiffTable differences={data?.differences || []} />

      <MetadataCopyPanel
        fields={data?.mergeable_fields || []}
        differences={data?.differences || []}
        source={childItem}
        target={parentId === left.id ? left : right}
        onCopy={copyMetadata}
        busy={busy}
      />

      {confirmDelete && (
        <ConfirmDelete
          item={items.find((i) => i.id === confirmDelete)}
          busy={busy}
          deleteFile={deleteFile}
          onToggleFile={setDeleteFile}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() =>
            act(() =>
              dupesApi.deleteItem(resourceType, confirmDelete, { deleteFile, reparentTo: '' })
            )
          }
        />
      )}

      {/* The decision bar. Kind applies to the non-parent copy: the parent is
          the edition itself, so only the other side needs describing. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          background: 'var(--bg-card)',
        }}
      >
        {childsMain ? (
          <VariantFamilyNotice
            main={childsMain}
            keeper={parentItem}
            busy={busy}
            onPromote={promoteOverFamily}
            onCompareMain={compareWithMain}
          />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
            {t('maintenance.dupes.linkExplainer', {
              child: childItem.filename,
              parent: parentItem.filename,
            })}
            {childHasFamily && (
              <div style={{ color: 'var(--gold)', marginTop: 6 }}>
                {t('maintenance.dupes.promoteWarning', {
                  count: childItem.variants.length,
                })}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 14,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            {t('maintenance.dupes.kindLabel')}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              style={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '7px 10px',
                fontSize: 13,
                minWidth: 190,
              }}
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {t(`variants.kind.${k}`, { defaultValue: k })}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            {t('maintenance.dupes.labelLabel')}
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('maintenance.dupes.labelPlaceholder')}
              style={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '7px 10px',
                fontSize: 13,
                minWidth: 190,
              }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={busy || !!childsMain}
            onClick={linkPair}
            style={{
              background: 'var(--gold-dim)',
              color: 'var(--bg-deep)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              cursor: 'pointer',
              fontSize: 13,
              opacity: busy || childsMain ? 0.6 : 1,
            }}
          >
            {busy ? <Spinner size={13} /> : <LuLayers size={13} aria-hidden="true" />}{' '}
            {t('maintenance.dupes.linkAs')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setParentId(childId)}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <LuArrowLeftRight size={13} aria-hidden="true" /> {t('maintenance.dupes.swapParent')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={dismissPair}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <LuX size={13} aria-hidden="true" /> {t('maintenance.dupes.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}

const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}
