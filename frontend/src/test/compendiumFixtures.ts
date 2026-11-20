// Shared fixtures for the compendium component tests.

export const SPELL_TYPE = {
  name: 'spell',
  label: 'Spell',
  label_plural: 'Spells',
  identity_field: 'name',
  sort_default: ['level', 'name'],
  search_fields: ['name'],
  filter_fields: ['school', 'subschool'],
  filter_depends: { subschool: 'school' },
  compact_display: '{school} {level}',
  fields: {
    name: { type: 'text', label: 'Name' },
    level: { type: 'number', label: 'Level' },
    school: { type: 'text', label: 'School' },
    subschool: { type: 'text', label: 'Subschool' },
    description: { type: 'textarea', label: 'Description' },
  },
  entry_count: 2,
}

export const CONDITION_TYPE = {
  name: 'condition',
  label: 'Condition',
  label_plural: 'Conditions',
  identity_field: 'name',
  fields: { name: { type: 'text' }, description: { type: 'textarea' } },
  entry_count: 1,
}

export const entry = (overrides: Record<string, unknown> = {}) => ({
  entry_id: 'fireball',
  source: 'srd',
  name: 'Fireball',
  content_type: 'spell',
  data: { name: 'Fireball', level: 3, school: 'Evocation', description: 'Boom.\nBig boom.' },
  display: 'Evocation 3',
  ruleset: false,
  owner_name: '',
  ruleset_name: '',
  schema_id: 'demo',
  origin: 'demo-srd',
  ...overrides,
})

export const PACK = {
  pack_id: 'demo-srd',
  name: 'Demo SRD',
  schema_id: 'demo',
  license: 'CC-BY-4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'This work includes material from the Demo SRD.',
  installed: true,
}

export const summary = (overrides: Record<string, unknown> = {}) => ({
  system_id: 's1',
  packs: [PACK],
  sheets: [],
  content_types: [CONDITION_TYPE, SPELL_TYPE],
  can_edit: false,
  ...overrides,
})
