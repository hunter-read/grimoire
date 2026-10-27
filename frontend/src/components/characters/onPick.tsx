// What picking an entry does to the rest of a character.
//
// A content_ref field may carry `on_pick` rules: picking a background grants
// its skills and origin feat, picking a class asks for its skill choices. The
// rules are data in the sheet, so this engine knows nothing about any game.
//
// Everything a pick adds is recorded under `_granted[field]`, which is what
// lets re-picking take it back off: switch Acolyte for Sage and the Acolyte's
// skills go, rather than the sheet accumulating every background ever tried.
// Only what a pick actually *added* is recorded, so a skill the player already
// had is never removed by changing their mind about something else.
//
// The result is ordinary data. Nothing here locks a value: the player can
// remove a granted feat or add a skill no pick offered, and a sheet with no
// content installed at all works exactly as it did before.

export const GRANTED_KEY = '_granted'

// A property read off an entry as a list: a real list, or comma-separated text
// for content written before lists were declared.
function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function optionValues(definition) {
  return (definition?.options || []).map((option) =>
    option && typeof option === 'object' ? String(option.value) : String(option)
  )
}

// Whether a content-list item is the one a grant recorded under `key`: a
// reference by its id, a freeform entry by its name.
function matchesKey(item, key) {
  if (!item || typeof item !== 'object') return false
  if (item._ref !== undefined && item._ref !== null) return String(item._ref) === key
  return !!item._inline && String(item.name ?? '') === key
}

function currentList(data, patch, target) {
  const value = target in patch ? patch[target] : data?.[target]
  return Array.isArray(value) ? [...value] : []
}

/**
 * Work out what picking `entry` into `field` changes.
 *
 * @param {object} args
 * @param {object} args.document  the validated schema
 * @param {object} args.data      the character's data, *before* this pick
 * @param {string} args.field     the content_ref field that was picked
 * @param {object|null} args.entry  the picked entry's own properties, or null
 *   when the pick was cleared
 * @param {(ids: string[]) => Promise<object>} [args.lookup]  resolves entry ids
 *   to `{content_type, source, missing}`, for granting a reference only when
 *   the catalog really has it
 * @returns {Promise<{patch: object, choices: object[]}>} the data to write, and
 *   any choices the player still has to make
 */
export async function planPick({ document, data, field, entry, lookup }) {
  const fields = document?.fields || {}
  const rules = Array.isArray(fields[field]?.on_pick) ? fields[field].on_pick : []
  const patch = {}
  const choices = []

  const granted = { ...(data?.[GRANTED_KEY] || {}) }
  const previous = granted[field] || {}
  const hadGrants = Object.keys(previous).length > 0
  delete granted[field]

  // Take back whatever the previous pick added.
  for (const [target, keys] of Object.entries(previous)) {
    const remove = new Set((keys || []).map(String))
    const list = currentList(data, patch, target)
    const targetType = fields[target]?.type
    patch[target] =
      targetType === 'content_list'
        ? list.filter((item) => ![...remove].some((key) => matchesKey(item, key)))
        : list.filter((value) => !remove.has(String(value)))
  }

  const recorded = {}
  const record = (target, key) => {
    recorded[target] = [...(recorded[target] || []), key]
  }

  if (entry && rules.length) {
    // Resolved up front, in one request, for every reference any rule grants.
    const wanted = []
    for (const rule of rules) {
      if (!rule.grant) continue
      if (rule.ref && entry[rule.ref]) wanted.push(String(entry[rule.ref]))
      if (rule.from && fields[rule.grant]?.type === 'content_list') {
        wanted.push(...asList(entry[rule.from]))
      }
    }
    let resolved = {}
    if (wanted.length && lookup) {
      try {
        resolved = (await lookup(wanted)) || {}
      } catch {
        // No catalog to ask is the same as the catalog not having it: the
        // grant falls back to a named entry rather than failing the pick.
        resolved = {}
      }
    }

    for (const rule of rules) {
      if (rule.grant) {
        const target = rule.grant
        const definition = fields[target]
        if (!definition) continue

        if (definition.type === 'multiselect') {
          const allowed = new Set(optionValues(definition))
          const list = currentList(data, patch, target)
          for (const value of asList(entry[rule.from])) {
            if (!allowed.has(value) || list.includes(value)) continue
            list.push(value)
            record(target, value)
          }
          patch[target] = list
          continue
        }

        if (definition.type === 'content_list') {
          const list = currentList(data, patch, target)
          // Values carried from the pick onto a freeform entry - the species'
          // name as each of its traits' source.
          const carried = {}
          for (const [toKey, fromKey] of Object.entries(rule.carry || {})) {
            if (entry[fromKey] !== undefined) carried[toKey] = entry[fromKey]
          }
          // One entry (`ref`/`name`) or several (`from`, with `names` in the
          // same order to fall back to).
          const pairs = rule.from
            ? asList(entry[rule.from]).map((id, i) => [id, asList(entry[rule.names])[i] || ''])
            : [
                [
                  rule.ref ? String(entry[rule.ref] ?? '') : '',
                  rule.name ? String(entry[rule.name] ?? '') : '',
                ],
              ]
          for (const [id, name] of pairs) {
            const found = id ? resolved[id] : null
            // A reference only when the catalog really has this id *as this
            // type* - resolve does not filter by type, and a feat and a spell
            // may share an id. Otherwise the name, so the player still sees
            // what they were given even without the content installed.
            if (found && !found.missing && found.content_type === definition.content_type) {
              if (!list.some((item) => matchesKey(item, id))) {
                list.push(found.source ? { _ref: id, _source: found.source } : { _ref: id })
                record(target, id)
              }
            } else if (name || id) {
              const label = name || id
              if (!list.some((item) => matchesKey(item, label))) {
                list.push({ _inline: true, ...carried, name: label })
                record(target, label)
              }
            }
          }
          patch[target] = list
        }
        continue
      }

      if (rule.choose) {
        const target = rule.choose
        const definition = fields[target]
        if (!definition) continue
        const allowed = new Set(optionValues(definition))
        const options = asList(entry[rule.from]).filter((value) => allowed.has(value))
        const count =
          typeof rule.count === 'string' ? Number(entry[rule.count]) || 0 : Number(rule.count ?? 1)
        if (count > 0 && options.length) {
          choices.push({ source: field, target, count, options, label: rule.label || '' })
        }
      }
    }
  }

  if (Object.keys(recorded).length) granted[field] = recorded
  if (hadGrants || Object.keys(recorded).length) patch[GRANTED_KEY] = granted
  return { patch, choices }
}

/**
 * Apply the values a player chose in a `choose` prompt.
 *
 * Recorded under the same source as the pick that asked, so re-picking the
 * class later takes the chosen skills back off along with everything else.
 */
export function applyChoice({ data, choice, picked }) {
  const list = Array.isArray(data?.[choice.target]) ? [...data[choice.target]] : []
  const added = []
  for (const value of picked || []) {
    if (list.includes(value)) continue
    list.push(value)
    added.push(value)
  }
  const granted = { ...(data?.[GRANTED_KEY] || {}) }
  const fromSource = { ...(granted[choice.source] || {}) }
  fromSource[choice.target] = [...(fromSource[choice.target] || []), ...added]
  granted[choice.source] = fromSource
  return { [choice.target]: list, [GRANTED_KEY]: granted }
}

/**
 * The value a field shows, and whether it is derived.
 *
 * A field with `default_from` that the player has not set shows the value the
 * context worked out. Once they set it, their value shows, and `overridden`
 * says there is an automatic value they could return to.
 *
 * A plain field the player has not set shows its `default`. The formulas were
 * already using it, so an ability score read as 10 in every modifier while its
 * own box sat empty - the sheet and its arithmetic disagreeing about the same
 * number.
 */
export function fieldState(name, definition, data, context) {
  const own = Object.prototype.hasOwnProperty.call(data || {}, name)
  const derivable = !!definition?.default_from
  let value = data?.[name]
  if (!own && derivable) value = context?.[name]
  else if (!own && definition && 'default' in definition) value = definition.default
  return {
    value,
    derived: derivable && !own,
    overridden: derivable && own,
  }
}
