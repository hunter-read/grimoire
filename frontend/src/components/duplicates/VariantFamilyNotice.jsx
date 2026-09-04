import { useTranslation } from 'react-i18next'
import { LuExternalLink, LuLayers } from 'react-icons/lu'

import Spinner from '../Spinner'

/**
 * The way out of the "that copy is already a variant" dead end.
 *
 * Both `link` and `promote` refuse to file a copy that is itself a variant of
 * some third item: doing so would build the three-level tree the two-level rule
 * exists to prevent. The service says so plainly — "promote its main version
 * instead" — but until now the UI could not name that main version, let alone
 * open it, so the user was told what to do and given no way to do it.
 *
 * The operation the user actually wants is one promote against the *family*:
 * the third item and everything under it re-homes onto the copy being kept. So
 * this offers exactly that, plus a link to review the main version first, since
 * moving a family sight-unseen is a bigger commitment than linking a pair.
 */
export default function VariantFamilyNotice({ main, keeper, busy, onPromote, onCompareMain }) {
  const { t } = useTranslation()
  const name = main.title || main.filename

  return (
    <div
      style={{
        border: '1px solid var(--gold-dim)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 14,
        background: 'rgba(198,160,74,0.07)',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ color: 'var(--gold)', fontWeight: 600, marginBottom: 4 }}>
        {t('maintenance.dupes.alreadyVariantTitle')}
      </div>
      <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>
        {t('maintenance.dupes.alreadyVariantBody', { main: name })}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
        {t('maintenance.dupes.alreadyVariantMoves', {
          count: main.variant_count,
          main: name,
          keeper: keeper.title || keeper.filename,
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={onPromote}
          style={{
            background: 'var(--gold-dim)',
            color: 'var(--bg-deep)',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: 13,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? <Spinner size={13} /> : <LuLayers size={13} aria-hidden="true" />}{' '}
          {t('maintenance.dupes.promoteOverFamily')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCompareMain}
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
          <LuExternalLink size={13} aria-hidden="true" /> {t('maintenance.dupes.compareWithMain')}
        </button>
      </div>
    </div>
  )
}
