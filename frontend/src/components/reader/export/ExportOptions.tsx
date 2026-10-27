import { useTranslation } from 'react-i18next'
import ExportSegmented from './ExportSegmented'
import type { ExportFormat } from './usePageExport'
import { hintStyle, labelStyle, sectionStyle, warnStyle } from './exportStyles'

export const DPI_OPTIONS = [96, 150, 300]
const DPI_NAMES: Record<number, string> = { 96: 'screen', 150: 'standard', 300: 'print' }

export interface ExportOptionsProps {
  formats: ExportFormat[]
  format: ExportFormat
  onFormatChange: (format: ExportFormat) => void
  dpi: number
  onDpiChange: (dpi: number) => void
  pixelSize?: { width: number; height: number } | null
  pixelSizeKey?: string
  pixelSizeParams?: Record<string, unknown>
  /** Format -> the reason it cannot be used right now. */
  disabledFormats?: Partial<Record<ExportFormat, string | false | null>>
}

/**
 * "Save as" and "Resolution", shared by both export tabs.
 *
 * Each format carries a one-line consequence rather than a spec: what it is
 * good for and what it gives up. Resolution only appears for image formats - a
 * PDF keeps the page's own vectors and has no resolution to choose - and shows
 * the pixel size it will produce, since "300 dpi" means little to someone
 * sizing a map for a virtual tabletop and "2550 × 3300 px" means everything.
 *
 * `disabledFormats` maps a format to the reason it cannot be used right now.
 */
export default function ExportOptions({
  formats,
  format,
  onFormatChange,
  dpi,
  onDpiChange,
  pixelSize,
  pixelSizeKey = 'pageExport.sizePerPage',
  pixelSizeParams,
  disabledFormats = {},
}: ExportOptionsProps) {
  const { t } = useTranslation()
  const isImage = format !== 'pdf'
  const blocked = disabledFormats[format]

  return (
    <>
      <div style={sectionStyle}>
        <span style={labelStyle}>{t('pageExport.formatLabel')}</span>
        <ExportSegmented
          ariaLabel={t('pageExport.formatLabel')}
          value={format}
          onChange={onFormatChange}
          options={formats.map((f) => ({
            value: f,
            label: t(`pageExport.format.${f}`),
            disabled: Boolean(disabledFormats[f]) && f !== format,
            title: disabledFormats[f] || undefined,
          }))}
        />
        <p style={blocked ? warnStyle : hintStyle} role={blocked ? 'alert' : undefined}>
          {blocked || t(`pageExport.formatHint.${format}`)}
        </p>
      </div>

      {isImage && (
        <div style={sectionStyle}>
          <span style={labelStyle}>{t('pageExport.resolutionLabel')}</span>
          <ExportSegmented
            ariaLabel={t('pageExport.resolutionLabel')}
            value={dpi}
            onChange={onDpiChange}
            options={DPI_OPTIONS.map((d) => ({
              value: d,
              label: t(`pageExport.dpi.${DPI_NAMES[d]}`),
              sub: t('pageExport.dpiValue', { dpi: d }),
            }))}
          />
          {pixelSize && (
            <p style={{ ...hintStyle, fontVariantNumeric: 'tabular-nums' }}>
              {t(pixelSizeKey, {
                ...pixelSizeParams,
                width: pixelSize.width,
                height: pixelSize.height,
              })}
            </p>
          )}
        </div>
      )}
    </>
  )
}
