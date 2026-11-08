// Shared army and league payloads for the army builder and league tests.
import type { Schema } from '../api'

export const unit: Schema<'RosterUnit'> = {
  id: 's1',
  name: 'Overlord',
  number: 1,
  costs: [{ name: 'pts', value: 85 }],
  categories: ['Character', 'Infantry'],
  primary_category: 'Character',
  profiles: [{ name: 'Overlord', type: 'Unit', characteristics: [{ name: 'M', value: '5"' }] }],
  rules: [
    { name: 'Reanimation', description: 'Comes back.', publication: 'Codex: Necrons', page: '70' },
  ],
  publication: 'Codex: Necrons',
  page: '82',
  children: [
    {
      id: 'c1',
      name: 'Resurrection Orb',
      number: 1,
      costs: [{ name: 'pts', value: 10 }],
      children: [],
    },
  ],
}

export const army: Schema<'ArmyDetail'> = {
  id: 'a1',
  name: 'Bones',
  user_id: 'u1',
  game_system_id: 's40k',
  game_system_name: 'Warhammer 40,000 10th Edition',
  system_name: 'Warhammer 40,000 10th Edition',
  faction: { id: 'f1', name: 'Necrons' },
  points: 195,
  points_limit: 2000,
  cost_name: 'pts',
  source: 'battlescribe',
  source_filename: 'Bones.rosz',
  can_edit: true,
  notes: 'Tomb world',
  progress: { s1: { experience: 3, honours: ['Hardened'], notes: '' } },
  publications: ['Codex: Necrons'],
  publication_links: {
    'Codex: Necrons': { book_id: 'b1', book_title: 'Codex: Necrons', page_offset: 2 },
  },
  data: {
    forces: [
      {
        id: 'f1',
        name: 'Army Roster',
        catalogue: 'Xenos - Necrons',
        units: [
          unit,
          {
            ...unit,
            id: 's2',
            name: 'Warriors',
            number: 10,
            profiles: [],
            rules: [],
            children: [],
          },
        ],
        forces: [{ id: 'f2', name: 'Allies', catalogue: '', units: [], forces: [] }],
      },
    ],
  },
}

export const manualArmy: Schema<'ArmyDetail'> = {
  ...army,
  id: 'a2',
  name: 'Hand built',
  source: 'manual',
  source_filename: '',
  publications: [],
  publication_links: {},
  data: {
    format: 'manual',
    forces: [
      {
        id: 'manual',
        units: [
          {
            id: 'm1',
            name: 'Knights',
            number: 5,
            costs: [{ name: 'pts', value: 120 }],
            primary_category: 'Battleline',
            notes: 'Shields up',
          },
        ],
        forces: [],
      },
    ],
  },
}

export const members: Schema<'LeagueMemberOut'>[] = [
  { user_id: 'u1', name: 'Ana', army: { id: 'a1', name: 'Bones', points: 195, cost_name: 'pts' } },
  { user_id: 'u2', name: 'Ben', army: null },
]

export const game: Schema<'LeagueGameOut'> = {
  id: 'g1',
  played_on: '2026-10-01',
  mission: 'Take and Hold',
  notes: 'Close one',
  player_a: { id: 'u1', name: 'Ana' },
  player_b: { id: 'u2', name: 'Ben' },
  score_a: 20,
  score_b: 10,
  result: 'a',
  can_edit: true,
}

export const league: Schema<'LeagueDetail'> = {
  id: 'l1',
  name: 'Winter League',
  description: 'Cold battles',
  organizer_id: 'u9',
  organizer_name: 'Gus',
  game_system_id: 's40k',
  game_system_name: 'Warhammer 40,000 10th Edition',
  points_limit: 1000,
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  status: 'active',
  member_count: 2,
  can_manage: true,
  is_member: true,
  members,
  games: [game],
  standings: [
    {
      user_id: 'u1',
      name: 'Ana',
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      score_for: 20,
      score_against: 10,
      points: 3,
    },
    {
      user_id: 'u2',
      name: 'Ben',
      played: 1,
      won: 0,
      drawn: 0,
      lost: 1,
      score_for: 10,
      score_against: 20,
      points: 0,
    },
  ],
}

export const systems = [
  { id: 's40k', name: 'Warhammer 40,000 10th Edition' },
  { id: 'saos', name: 'Age of Sigmar' },
] as Schema<'SystemSummary'>[]

export const factions: Schema<'FactionOut'>[] = [
  { id: 'f1', name: 'Necrons', parent_id: null, depth: 0, book_count: 2 },
  { id: 'f2', name: 'Szarekhan', parent_id: 'f1', depth: 1, book_count: 0 },
]
