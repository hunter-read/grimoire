/**
 * Wargames: the army builder (army lists, roster import and export, the source
 * books units cite) and leagues (members, registered armies, games, standings).
 */
import api, { client, getUrl, postUrl, type Id, type BodyOf, type ResponseOf } from './client'

const army = (id: Id) => ({ army_id: String(id) })
const league = (id: Id) => ({ league_id: String(id) })

export const armies = {
  list: () => client.get('/armies'),
  get: (id: Id) => client.get('/armies/{army_id}', { path: army(id) }),
  create: (body: BodyOf<'/armies', 'post'>) => client.post('/armies', { body }),
  update: (id: Id, body: BodyOf<'/armies/{army_id}', 'patch'>) =>
    client.patch('/armies/{army_id}', { path: army(id), body }),
  remove: (id: Id) => client.delete('/armies/{army_id}', { path: army(id) }),
  // A BattleScribe / New Recruit roster, .ros or .rosz.
  importRoster: (file: Blob, name?: string) =>
    api.upload(postUrl('/armies/import', {}), file, name ? { name } : {}) as Promise<
      ResponseOf<'/armies/import', 'post'>
    >,
  // `format` is "text" (a readable list) or "roster" (the imported file, unchanged).
  download: (id: Id, format: 'text' | 'roster', fallback: string) =>
    api.download(
      getUrl('/armies/{army_id}/export', { path: army(id), query: { format } }),
      fallback
    ),
  setProgress: (
    id: Id,
    unitId: string,
    body: BodyOf<'/armies/{army_id}/units/{unit_id}/progress', 'put'>
  ) =>
    client.put('/armies/{army_id}/units/{unit_id}/progress', {
      path: { ...army(id), unit_id: unitId },
      body,
    }),
  publications: (id: Id) => client.get('/armies/{army_id}/publications', { path: army(id) }),
  // GMs and admins: wargame books to link a cited publication to.
  searchBooks: (q: string) => client.get('/armies/publication-links/books', { query: { q } }),
  setLink: (body: BodyOf<'/armies/publication-links', 'put'>) =>
    client.put('/armies/publication-links', { body }),
  removeLink: (systemName: string, publication: string) =>
    client.delete('/armies/publication-links', {
      query: { system_name: systemName, publication },
    }),
  // The library's wargame systems (editions included), and one's factions.
  systems: () =>
    client.get('/systems', { query: { game_type: 'wargame', include_children: true } }),
  factions: (systemId: Id) =>
    client.get('/systems/{system_id}/factions', { path: { system_id: String(systemId) } }),
}

export const leagues = {
  list: () => client.get('/leagues'),
  get: (id: Id) => client.get('/leagues/{league_id}', { path: league(id) }),
  create: (body: BodyOf<'/leagues', 'post'>) => client.post('/leagues', { body }),
  update: (id: Id, body: BodyOf<'/leagues/{league_id}', 'patch'>) =>
    client.patch('/leagues/{league_id}', { path: league(id), body }),
  remove: (id: Id) => client.delete('/leagues/{league_id}', { path: league(id) }),
  eligible: (id: Id) => client.get('/leagues/{league_id}/eligible-members', { path: league(id) }),
  addMember: (id: Id, userId: string) =>
    client.post('/leagues/{league_id}/members', { path: league(id), body: { user_id: userId } }),
  removeMember: (id: Id, userId: string) =>
    client.delete('/leagues/{league_id}/members/{user_id}', {
      path: { ...league(id), user_id: userId },
    }),
  setArmy: (id: Id, userId: string, armyId: string | null) =>
    client.put('/leagues/{league_id}/members/{user_id}/army', {
      path: { ...league(id), user_id: userId },
      body: { army_id: armyId || null },
    }),
  logGame: (id: Id, body: BodyOf<'/leagues/{league_id}/games', 'post'>) =>
    client.post('/leagues/{league_id}/games', { path: league(id), body }),
  updateGame: (
    id: Id,
    gameId: string,
    body: BodyOf<'/leagues/{league_id}/games/{game_id}', 'put'>
  ) =>
    client.put('/leagues/{league_id}/games/{game_id}', {
      path: { ...league(id), game_id: gameId },
      body,
    }),
  removeGame: (id: Id, gameId: string) =>
    client.delete('/leagues/{league_id}/games/{game_id}', {
      path: { ...league(id), game_id: gameId },
    }),
}
