/**
 * A single-value text input backed by a datalist of known options — the user
 * can pick an existing value or type a new one. Used for System Family.
 */
export default function LookupCombobox({ id, value, onChange, options, placeholder = '' }) {
  const listId = `${id}-options`
  return (
    <>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}
