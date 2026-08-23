import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LuCheck, LuLayers } from 'react-icons/lu'

/**
 * "Switch version" rows for the reader's overflow menu.
 *
 * Separate from ReaderMoreMenu so its router hooks only mount for a book that
 * actually has other versions — the menu itself is rendered in contexts (and
 * unit tests) that have no Router above them.
 *
 * Switching carries the current page across: moving between a spreads cut and a
 * single-page cut of the same book should land on the same spot rather than
 * bouncing the reader back to page one.
 */
export default function ReaderVariantItems({ book, bookId, itemStyle, dividerStyle, run }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // (main entry + its variants) as one flat list.
  const options = [
    { id: book.variant_main_id || book.id, isMain: true },
    ...(book.variants || []).map((v) => ({ ...v, isMain: false })),
  ]
  if (options.length < 2) return null

  return (
    <>
      <div style={dividerStyle} role="separator" />
      <div style={{ ...itemStyle, cursor: 'default', color: 'var(--text-muted)', fontSize: 12 }}>
        <LuLayers size={15} aria-hidden="true" />
        {t('variants.switchLabel')}
      </div>
      {options.map((option) => (
        <button
          key={option.id}
          role="menuitemradio"
          aria-checked={option.id === bookId}
          onClick={run(() => {
            if (option.id === bookId) return
            const page = searchParams.get('page')
            navigate(`/library/book/${option.id}${page ? `?page=${page}` : ''}`)
          })}
          style={{ ...itemStyle, paddingLeft: 30, fontSize: 13 }}
        >
          {option.id === bookId ? (
            <LuCheck size={13} aria-hidden="true" />
          ) : (
            <span style={{ width: 13 }} />
          )}
          {option.isMain
            ? t('variants.mainVersion')
            : option.label || t(`variants.kind.${option.kind}`, { defaultValue: option.kind })}
        </button>
      ))}
    </>
  )
}
