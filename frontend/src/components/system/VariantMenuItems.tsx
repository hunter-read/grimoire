import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck, LuLayers } from 'react-icons/lu'
import { useNavigate } from 'react-router-dom'

import api from '../../api'
import type { Schema } from '../../api'
import variantLabel, { mainOption } from '../../utils/variantLabel'

/**
 * "Switch version" rows for a book's overflow menu.
 *
 * List rows carry only `variant_count`, not the family itself, so the sibling
 * list is fetched the first time the section is expanded rather than on every
 * card render — a shelf of 200 books must not fire 200 requests for a menu
 * nobody opened.
 *
 * Mounted only for a book that actually has other versions (see the guard at
 * the call site), which is also what keeps it clear of callers that render the
 * menu outside a Router.
 */
export interface VariantMenuItemsProps {
  book: { id: string }
  itemStyle?: CSSProperties
  /** Called with the picked version's id, to close the menu. */
  onPick?: (id: string) => void
}

/** One version in the list: the main entry or one of its variants. */
interface VariantOption {
  id: string
  isMain: boolean
  kind?: string
  label?: string
  filename?: string
}

export default function VariantMenuItems({ book, itemStyle, onPick }: VariantMenuItemsProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [family, setFamily] = useState<VariantOption[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || family || loading) return
    // The detail endpoint returns the whole family from either end, so one
    // request covers both "this is the main entry" and "this is a variant".
    setLoading(true)
    api
      .get(`/books/${book.id}`)
      .then((data) =>
        setFamily([
          mainOption(data as Schema<'BookDetail'>),
          ...((data as Schema<'BookDetail'>).variants || []).map((v) => ({ ...v, isMain: false })),
        ])
      )
      .catch(() => setFamily([]))
      .finally(() => setLoading(false))
  }, [open, family, loading, book.id])

  const label = (option: VariantOption): string => variantLabel(option, t)

  return (
    <>
      <button
        role="menuitem"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        style={itemStyle}
      >
        <LuLayers size={15} aria-hidden="true" />
        {t('variants.switchLabel')}
      </button>
      {open &&
        (loading ? (
          <div style={{ ...itemStyle, opacity: 0.6, cursor: 'default' }}>{t('common.loading')}</div>
        ) : (
          (family || []).map((option) => (
            <button
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === book.id}
              onClick={(e) => {
                e.stopPropagation()
                onPick?.(option.id)
                if (option.id !== book.id) navigate(`/library/book/${option.id}`)
              }}
              style={{ ...itemStyle, paddingLeft: 30, fontSize: 13 }}
            >
              {option.id === book.id ? (
                <LuCheck size={13} aria-hidden="true" />
              ) : (
                <span style={{ width: 13 }} />
              )}
              {label(option)}
            </button>
          ))
        ))}
    </>
  )
}
