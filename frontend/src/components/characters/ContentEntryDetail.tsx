import FieldRenderer from './FieldRenderer'
import type { FieldDefinition } from './FieldRenderer'

/** A content type as a schema declares it: its fields and how an entry reads. */
export interface ContentTypeDefinition {
  label?: string
  label_plural?: string
  identity_field?: string
  compact_display?: string
  fields?: Record<string, FieldDefinition>
  [key: string]: unknown
}

/** A content_ref/content_list field's definition - the keys those fields read. */
export interface ContentFieldDefinition extends FieldDefinition {
  allow_freeform?: boolean
  per_entry_fields?: Record<string, FieldDefinition>
  display_columns?: (string | { key: string; label?: string })[]
}

export interface ContentEntryDetailProps {
  // A catalog entry, or anything carrying an entry's values under `data`.
  entry: { data?: Record<string, unknown> }
  typeDefinition: ContentTypeDefinition
}

/**
 * One entry, rendered read-only through the same FieldRenderer the sheet uses.
 *
 * Deliberately not a second renderer: a content type is a field schema applied
 * to catalog entries, so the component that draws a character's fields draws an
 * entry's too.
 */
export default function ContentEntryDetail({ entry, typeDefinition }: ContentEntryDetailProps) {
  const fields = typeDefinition.fields || {}
  const identity = typeDefinition.identity_field || 'name'

  return (
    <div
      style={{
        margin: '6px 0 0',
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-deep)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 10,
      }}
    >
      {Object.entries(fields)
        // The name is already the row's heading; repeating it wastes a cell.
        .filter(([name]) => name !== identity)
        .map(([name, definition]) => (
          <div
            key={name}
            style={definition.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}
          >
            <FieldRenderer
              name={name}
              definition={definition}
              value={entry.data?.[name]}
              readOnly
            />
          </div>
        ))}
    </div>
  )
}
