/**
 * Campaigns (the Campaign Manager): members, guests, media, resources, sessions,
 * the wiki and its templates, categories, scheduling and calendar feeds.
 */
import api, {
  client,
  getUrl,
  postUrl,
  mediaUrl,
  cacheBust,
  withQuery,
  type Id,
  type BodyOf,
  type QueryOf,
  type ResponseOf,
  type FolderEntry,
} from './client'

/** Which resource categories (note | resource) a category list is for. */
type CategoryKind = QueryOf<'/campaigns/{campaign_id}/categories', 'get'>['kind']

/** Optional resource-category filing for a campaign upload. */
interface UploadFiling {
  categoryId?: string | null
  newCategoryName?: string | null
}

function filingFields(opts: UploadFiling): Record<string, string> {
  const fields: Record<string, string> = {}
  if (opts.categoryId) fields.category_id = opts.categoryId
  if (opts.newCategoryName) fields.new_category_name = opts.newCategoryName
  return fields
}

const campaign = (id: Id) => ({ campaign_id: id })

// Campaign Manager helpers
export const campaigns = {
  // includeArchived widens the list to archived campaigns as well as active
  // ones; the default list is the active games only.
  list: (includeArchived = false) =>
    client.get('/campaigns', {
      query: includeArchived ? { include_archived: true } : undefined,
    }),
  invites: () => client.get('/campaigns/invites'),
  get: (id: Id) => client.get('/campaigns/{campaign_id}', { path: campaign(id) }),
  create: (data: BodyOf<'/campaigns', 'post'>) => client.post('/campaigns', { body: data }),
  update: (id: Id, data: BodyOf<'/campaigns/{campaign_id}', 'patch'>) =>
    client.patch('/campaigns/{campaign_id}', { path: campaign(id), body: data }),
  delete: (id: Id) => client.delete('/campaigns/{campaign_id}', { path: campaign(id) }),
  // One-way: a group campaign cannot be turned back into a personal one.
  convertToGroup: (id: Id, gmTitle?: string) =>
    client.post('/campaigns/{campaign_id}/convert-to-group', {
      path: campaign(id),
      body: gmTitle ? { gm_title: gmTitle } : {},
    }),
  setArchived: (id: Id, archived: boolean) =>
    client.put('/campaigns/{campaign_id}/archive', { path: campaign(id), body: { archived } }),

  // Members
  invite: (id: Id, userId: string) =>
    client.post('/campaigns/{campaign_id}/invite', {
      path: campaign(id),
      body: { user_id: userId },
    }),
  updateMember: (id: Id, userId: Id, status: string) =>
    client.patch('/campaigns/{campaign_id}/members/{user_id}', {
      path: { campaign_id: id, user_id: userId },
      body: { status },
    }),
  setCharacterName: (id: Id, userId: Id, character_name: string) =>
    client.patch('/campaigns/{campaign_id}/members/{user_id}', {
      path: { campaign_id: id, user_id: userId },
      body: { character_name },
    }),
  setCharacterSheetUrl: (id: Id, userId: Id, character_sheet_url: string) =>
    client.patch('/campaigns/{campaign_id}/members/{user_id}', {
      path: { campaign_id: id, user_id: userId },
      body: { character_sheet_url },
    }),
  removeMember: (id: Id, userId: Id) =>
    client.delete('/campaigns/{campaign_id}/members/{user_id}', {
      path: { campaign_id: id, user_id: userId },
    }),
  eligibleMembers: (id: Id) =>
    client.get('/campaigns/{campaign_id}/eligible-members', { path: campaign(id) }),

  // Guests (code-based, GM-managed)
  listGuests: (id: Id) => client.get('/campaigns/{campaign_id}/guests', { path: campaign(id) }),
  createGuest: (id: Id, nickname: string) =>
    client.post('/campaigns/{campaign_id}/guests', { path: campaign(id), body: { nickname } }),
  regenerateGuestCode: (id: Id, memberId: Id) =>
    client.post('/campaigns/{campaign_id}/guests/{member_id}/regenerate', {
      path: { campaign_id: id, member_id: memberId },
    }),
  removeGuest: (id: Id, memberId: Id) =>
    client.delete('/campaigns/{campaign_id}/guests/{member_id}', {
      path: { campaign_id: id, member_id: memberId },
    }),
  guestShareTemplate: (id: Id, memberId: Id) =>
    client.get('/campaigns/{campaign_id}/guests/{member_id}/share-template', {
      path: { campaign_id: id, member_id: memberId },
    }),

  // Banner (keyed by campaign id)
  uploadBanner: (id: Id, file: Blob) =>
    api.upload(postUrl('/campaigns/{campaign_id}/banner', { path: campaign(id) }), file),
  deleteBanner: (id: Id) =>
    client.delete('/campaigns/{campaign_id}/banner', { path: campaign(id) }),
  // Set the banner from an image the server already holds, instead of
  // re-uploading a copy of something Grimoire has (issue #286).
  setBannerFromSource: (id: Id, sourceType: string, sourceId: string) =>
    client.post('/campaigns/{campaign_id}/banner/from-source', {
      path: campaign(id),
      body: { source_type: sourceType, source_id: sourceId },
    }),
  // Vertical focal point of the banner in the 2:1 hero, 0-100 (50 = centred).
  setBannerFocus: (id: Id, focusY: number) =>
    client.put('/campaigns/{campaign_id}/banner/focus', {
      path: campaign(id),
      body: { focus_y: focusY },
    }),
  // `v` cache-busts the upload cache after a re-upload so the fresh banner is
  // fetched instead of the stale copy the browser is still holding. It must go
  // through mediaUrl as a real query param — media URLs no longer carry a
  // ?token= (auth moved to the HttpOnly cookie in #218), so appending "&v=..."
  // to the bare path produced a malformed, unroutable URL.
  bannerUrl: (id: Id, v?: Id | null) =>
    mediaUrl(getUrl('/campaigns/{campaign_id}/banner', { path: campaign(id) }), cacheBust(v)),

  // Character art & sheet (keyed by CampaignMember id)
  uploadMemberArt: (id: Id, memberId: Id, file: Blob) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/members/{member_id}/art', {
        path: { campaign_id: id, member_id: memberId },
      }),
      file
    ),
  deleteMemberArt: (id: Id, memberId: Id) =>
    client.delete('/campaigns/{campaign_id}/members/{member_id}/art', {
      path: { campaign_id: id, member_id: memberId },
    }),
  // `v` cache-busts the 5-minute upload cache after a re-upload (or a token made
  // in the editor) so the fresh art is fetched rather than the stale copy the
  // browser is still holding — same reason as `bannerUrl` above.
  memberArtUrl: (id: Id, memberId: Id, v?: Id | null) =>
    mediaUrl(
      getUrl('/campaigns/{campaign_id}/members/{member_id}/art', {
        path: { campaign_id: id, member_id: memberId },
      }),
      cacheBust(v)
    ),
  // The character's VTT token — a separate picture from the art above, with the
  // same "the member themselves or the campaign owner" permission rule.
  uploadMemberToken: (id: Id, memberId: Id, file: Blob) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/members/{member_id}/token', {
        path: { campaign_id: id, member_id: memberId },
      }),
      file
    ),
  deleteMemberToken: (id: Id, memberId: Id) =>
    client.delete('/campaigns/{campaign_id}/members/{member_id}/token', {
      path: { campaign_id: id, member_id: memberId },
    }),
  memberTokenUrl: (id: Id, memberId: Id, v?: Id | null) =>
    mediaUrl(
      getUrl('/campaigns/{campaign_id}/members/{member_id}/token', {
        path: { campaign_id: id, member_id: memberId },
      }),
      cacheBust(v)
    ),
  uploadMemberSheet: (id: Id, memberId: Id, file: Blob) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/members/{member_id}/sheet', {
        path: { campaign_id: id, member_id: memberId },
      }),
      file
    ),
  deleteMemberSheet: (id: Id, memberId: Id) =>
    client.delete('/campaigns/{campaign_id}/members/{member_id}/sheet', {
      path: { campaign_id: id, member_id: memberId },
    }),
  // `v` cache-busts the 5-minute upload cache after an in-app edit so the fresh
  // PDF is fetched instead of the stale copy the browser is still holding.
  memberSheetUrl: (id: Id, memberId: Id, v?: Id | null) =>
    mediaUrl(
      getUrl('/campaigns/{campaign_id}/members/{member_id}/sheet', {
        path: { campaign_id: id, member_id: memberId },
      }),
      cacheBust(v)
    ),
  duplicateMemberSheet: (
    id: Id,
    memberId: Id,
    body: BodyOf<'/campaigns/{campaign_id}/members/{member_id}/sheet/duplicate', 'post'>
  ) =>
    client.post('/campaigns/{campaign_id}/members/{member_id}/sheet/duplicate', {
      path: { campaign_id: id, member_id: memberId },
      body,
    }),
  listSheetSources: (id: Id) =>
    client.get('/campaigns/{campaign_id}/sheet-sources', { path: campaign(id) }),

  // Resources
  listResources: (id: Id) =>
    client.get('/campaigns/{campaign_id}/resources', { path: campaign(id) }),
  addResource: (id: Id, data: BodyOf<'/campaigns/{campaign_id}/resources', 'post'>) =>
    client.post('/campaigns/{campaign_id}/resources', { path: campaign(id), body: data }),
  bulkAddResources: (
    id: Id,
    resources: BodyOf<'/campaigns/{campaign_id}/resources/bulk', 'post'>['resources']
  ) =>
    client.post('/campaigns/{campaign_id}/resources/bulk', {
      path: campaign(id),
      body: { resources },
    }),
  updateResource: (
    id: Id,
    resourceId: Id,
    patch: BodyOf<'/campaigns/{campaign_id}/resources/{resource_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/resources/{resource_id}', {
      path: { campaign_id: id, resource_id: resourceId },
      body: patch,
    }),
  reorderResources: (id: Id, orderedIds: string[]) =>
    client.put('/campaigns/{campaign_id}/resources/reorder', {
      path: campaign(id),
      body: { ordered_ids: orderedIds },
    }),
  removeResource: (id: Id, resourceId: Id) =>
    client.delete('/campaigns/{campaign_id}/resources/{resource_id}', {
      path: { campaign_id: id, resource_id: resourceId },
    }),
  suggestedResources: (systemId: Id) =>
    client.get('/campaigns/resources/suggested/{system_id}', { path: { system_id: systemId } }),

  // GM-uploaded campaign files (linked as resource_type='file').
  // opts: { categoryId, newCategoryName } file it under a resource category in
  // the same call — the map editor sends a finished .uvtt straight into one.
  uploadFile: (id: Id, file: Blob, opts: UploadFiling = {}) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/files', { path: campaign(id) }),
      file,
      filingFields(opts)
    ),
  fileUrl: (id: Id, fileId: Id) =>
    mediaUrl(
      getUrl('/campaigns/{campaign_id}/files/{file_id}', {
        path: { campaign_id: id, file_id: fileId },
      })
    ),
  // Image upload for note embedding. opts: { categoryId, newCategoryName }.
  uploadImage: (id: Id, file: Blob, opts: UploadFiling = {}) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/images', { path: campaign(id) }),
      file,
      filingFields(opts)
    ),
  // `limit` is applied per resource type server-side. It defaults high because
  // the picker browses a whole collection as a folder tree rather than showing a
  // preview slice; the server clamps it to its own ceiling.
  searchResources: (q = '', resourceType = '', systemId = '', limit = 5000) =>
    client.get('/campaigns/resources/search', {
      query: {
        q: q || undefined,
        resource_type: resourceType || undefined,
        system_id: systemId || undefined,
        limit,
      },
    }),

  // Sessions
  listSessions: (id: Id) => client.get('/campaigns/{campaign_id}/sessions', { path: campaign(id) }),
  createSession: (id: Id, data: BodyOf<'/campaigns/{campaign_id}/sessions', 'post'>) =>
    client.post('/campaigns/{campaign_id}/sessions', { path: campaign(id), body: data }),
  getSession: (id: Id, sessionId: Id) =>
    client.get('/campaigns/{campaign_id}/sessions/{session_id}', {
      path: { campaign_id: id, session_id: sessionId },
    }),
  updateSession: (
    id: Id,
    sessionId: Id,
    data: BodyOf<'/campaigns/{campaign_id}/sessions/{session_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/sessions/{session_id}', {
      path: { campaign_id: id, session_id: sessionId },
      body: data,
    }),
  deleteSession: (id: Id, sessionId: Id) =>
    client.delete('/campaigns/{campaign_id}/sessions/{session_id}', {
      path: { campaign_id: id, session_id: sessionId },
    }),
  savePlayerNote: (id: Id, sessionId: Id, content: string) =>
    client.put('/campaigns/{campaign_id}/sessions/{session_id}/notes/player', {
      path: { campaign_id: id, session_id: sessionId },
      body: { content },
    }),
  saveGMNote: (
    id: Id,
    sessionId: Id,
    data: BodyOf<'/campaigns/{campaign_id}/sessions/{session_id}/notes/gm', 'put'>
  ) =>
    client.put('/campaigns/{campaign_id}/sessions/{session_id}/notes/gm', {
      path: { campaign_id: id, session_id: sessionId },
      body: data,
    }),
  searchSessions: (id: Id, q: string) =>
    client.get('/campaigns/{campaign_id}/sessions/search', { path: campaign(id), query: { q } }),

  // Wiki pages. `opts` carries the sidebar filters: `mine` restricts to pages
  // the user authored, `includeHidden` brings back the ones they hid.
  listWikiPages: (id: Id, opts: { mine?: boolean; includeHidden?: boolean } = {}) =>
    client.get('/campaigns/{campaign_id}/wiki', {
      path: campaign(id),
      query: {
        mine: opts.mine ? true : undefined,
        include_hidden: opts.includeHidden ? true : undefined,
      },
    }),
  getWikiPage: (id: Id, pageId: Id) =>
    client.get('/campaigns/{campaign_id}/wiki/{page_id}', {
      path: { campaign_id: id, page_id: pageId },
    }),
  createWikiPage: (id: Id, data: BodyOf<'/campaigns/{campaign_id}/wiki', 'post'>) =>
    client.post('/campaigns/{campaign_id}/wiki', { path: campaign(id), body: data }),
  updateWikiPage: (
    id: Id,
    pageId: Id,
    data: BodyOf<'/campaigns/{campaign_id}/wiki/{page_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/wiki/{page_id}', {
      path: { campaign_id: id, page_id: pageId },
      body: data,
    }),
  deleteWikiPage: (id: Id, pageId: Id) =>
    client.delete('/campaigns/{campaign_id}/wiki/{page_id}', {
      path: { campaign_id: id, page_id: pageId },
    }),
  hideWikiPage: (id: Id, pageId: Id) =>
    client.post('/campaigns/{campaign_id}/wiki/{page_id}/hide', {
      path: { campaign_id: id, page_id: pageId },
    }),
  unhideWikiPage: (id: Id, pageId: Id) =>
    client.delete('/campaigns/{campaign_id}/wiki/{page_id}/hide', {
      path: { campaign_id: id, page_id: pageId },
    }),
  searchWiki: (id: Id, q: string) =>
    client.get('/campaigns/{campaign_id}/wiki/search', { path: campaign(id), query: { q } }),
  wikiTitles: (id: Id) =>
    client.get('/campaigns/{campaign_id}/wiki/titles', { path: campaign(id) }),
  reorderWikiPages: (id: Id, orderedIds: string[]) =>
    client.put('/campaigns/{campaign_id}/wiki/reorder', {
      path: campaign(id),
      body: { ordered_ids: orderedIds },
    }),
  // `format` is the API's name for the shape (md = zip of files, mdfile = one
  // combined file, json = bundle); the fallback filename maps it to the actual
  // extension, for the rare response with no Content-Disposition.
  exportWiki: (
    id: Id,
    format: NonNullable<QueryOf<'/campaigns/{campaign_id}/wiki/export', 'get'>['format']>
  ) =>
    api.download(
      getUrl('/campaigns/{campaign_id}/wiki/export', { path: campaign(id), query: { format } }),
      `wiki.${({ md: 'zip', mdfile: 'md' } as Record<string, string>)[format] || format}`
    ),
  importWiki: (id: Id, file: Blob) =>
    api.upload(postUrl('/campaigns/{campaign_id}/wiki/import', { path: campaign(id) }), file),
  // A picked folder of markdown, sent whole so nesting and cross-links resolve
  // in one pass. `entries` is `[{ file, path }]` — `path` being the file's path
  // within the folder the user picked (the browser's `webkitRelativePath`).
  importWikiFolder: (id: Id, entries: FolderEntry[]) =>
    api.uploadFolder(
      postUrl('/campaigns/{campaign_id}/wiki/import', { path: campaign(id) }),
      entries
    ),
  // Wiki note templates — per-campaign starting points for pages.
  wikiTemplates: (id: Id) =>
    client.get('/campaigns/{campaign_id}/wiki/templates', { path: campaign(id) }),
  getWikiTemplate: (id: Id, templateId: string) =>
    client.get('/campaigns/{campaign_id}/wiki/templates/{template_id}', {
      path: { campaign_id: id, template_id: templateId },
    }),
  createWikiTemplate: (id: Id, data: BodyOf<'/campaigns/{campaign_id}/wiki/templates', 'post'>) =>
    client.post('/campaigns/{campaign_id}/wiki/templates', { path: campaign(id), body: data }),
  updateWikiTemplate: (
    id: Id,
    templateId: string,
    data: BodyOf<'/campaigns/{campaign_id}/wiki/templates/{template_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/wiki/templates/{template_id}', {
      path: { campaign_id: id, template_id: templateId },
      body: data,
    }),
  deleteWikiTemplate: (id: Id, templateId: string) =>
    client.delete('/campaigns/{campaign_id}/wiki/templates/{template_id}', {
      path: { campaign_id: id, template_id: templateId },
    }),
  uploadWikiTemplate: (id: Id, file: Blob) =>
    api.upload(
      postUrl('/campaigns/{campaign_id}/wiki/templates/upload', { path: campaign(id) }),
      file
    ),
  exportWikiTemplate: (id: Id, templateId: string, name?: string) =>
    api.download(
      getUrl('/campaigns/{campaign_id}/wiki/templates/{template_id}/export', {
        path: { campaign_id: id, template_id: templateId },
      }),
      `${name || 'template'}.zip`
    ),
  useWikiTemplate: (id: Id, templateId: string) =>
    client.post('/campaigns/{campaign_id}/wiki/templates/{template_id}/use', {
      path: { campaign_id: id, template_id: templateId },
    }),
  // The community catalogue. `_t` defeats any HTTP cache between here and the
  // server, so a refresh really asks again.
  browseWikiTemplates: (id: Id, refresh?: boolean) =>
    api.get(
      withQuery(
        getUrl('/campaigns/{campaign_id}/wiki/templates/browse', {
          path: campaign(id),
          query: { refresh: refresh ? true : undefined },
        }),
        [['_t', String(Date.now())]]
      )
    ) as Promise<ResponseOf<'/campaigns/{campaign_id}/wiki/templates/browse', 'get'>>,
  downloadWikiTemplate: (id: Id, templateId: string, indexUrl?: string | null) =>
    client.post('/campaigns/{campaign_id}/wiki/templates/download/{template_id}', {
      path: { campaign_id: id, template_id: templateId },
      query: { index_url: indexUrl || undefined },
    }),

  // Categories (kind: 'note' | 'resource')
  listCategories: (id: Id, kind?: CategoryKind) =>
    client.get('/campaigns/{campaign_id}/categories', {
      path: campaign(id),
      query: { kind: kind || undefined },
    }),
  createCategory: (id: Id, name: string, kind: CategoryKind, icon?: string | null) =>
    client.post('/campaigns/{campaign_id}/categories', {
      path: campaign(id),
      body: { name, kind, icon } as BodyOf<'/campaigns/{campaign_id}/categories', 'post'>,
    }),
  updateCategory: (
    id: Id,
    categoryId: Id,
    patch: BodyOf<'/campaigns/{campaign_id}/categories/{category_id}', 'patch'>
  ) =>
    client.patch('/campaigns/{campaign_id}/categories/{category_id}', {
      path: { campaign_id: id, category_id: categoryId },
      body: patch,
    }),
  renameCategory: (id: Id, categoryId: Id, name: string) =>
    client.patch('/campaigns/{campaign_id}/categories/{category_id}', {
      path: { campaign_id: id, category_id: categoryId },
      body: { name },
    }),
  reorderCategories: (id: Id, orderedIds: string[]) =>
    client.put('/campaigns/{campaign_id}/categories/reorder', {
      path: campaign(id),
      body: { ordered_ids: orderedIds },
    }),
  // Persist the resource panel's group display order (category + type-group keys).
  setResourceGroupOrder: (id: Id, orderedKeys: string[]) =>
    client.put('/campaigns/{campaign_id}/resource-group-order', {
      path: campaign(id),
      body: { ordered_keys: orderedKeys },
    }),
  // mode: 'uncategorize' | 'delete_items'
  deleteCategory: (
    id: Id,
    categoryId: Id,
    mode: QueryOf<'/campaigns/{campaign_id}/categories/{category_id}', 'delete'>['mode']
  ) =>
    client.delete('/campaigns/{campaign_id}/categories/{category_id}', {
      path: { campaign_id: id, category_id: categoryId },
      query: { mode },
    }),

  // Schedule
  getSchedule: (id: Id) => client.get('/campaigns/{campaign_id}/schedule', { path: campaign(id) }),
  setSchedule: (id: Id, data: BodyOf<'/campaigns/{campaign_id}/schedule', 'put'>) =>
    client.put('/campaigns/{campaign_id}/schedule', { path: campaign(id), body: data }),
  deleteSchedule: (id: Id) =>
    client.delete('/campaigns/{campaign_id}/schedule', { path: campaign(id) }),

  // Availability
  getAvailability: (id: Id) =>
    client.get('/campaigns/{campaign_id}/availability', { path: campaign(id) }),
  setAvailability: (
    id: Id,
    date: string,
    data: BodyOf<'/campaigns/{campaign_id}/availability/{session_date}', 'put'>
  ) =>
    client.put('/campaigns/{campaign_id}/availability/{session_date}', {
      path: { campaign_id: id, session_date: date },
      body: data,
    }),
  cancelDate: (id: Id, date: string) =>
    client.put('/campaigns/{campaign_id}/availability/{session_date}/cancel', {
      path: { campaign_id: id, session_date: date },
    }),

  // Calendar export / subscription
  downloadCalendar: (id: Id, name?: string) =>
    api.download(
      getUrl('/campaigns/{campaign_id}/calendar.ics', { path: campaign(id) }),
      `${name || 'campaign'}.ics`
    ),
  getCalendarSubscription: (id?: Id | null) =>
    client.get('/campaigns/calendar/subscription', {
      query: { campaign_id: id ? String(id) : undefined },
    }),
  generateCalendarToken: (id?: Id | null) =>
    client.post('/campaigns/calendar/subscription', {
      query: { campaign_id: id ? String(id) : undefined },
    }),
  revokeCalendarToken: () => client.delete('/campaigns/calendar/subscription'),

  // Admin: read-only view of a user's campaigns (user page)
  adminListByUser: (userId: Id) =>
    client.get('/campaigns/admin/by-user/{user_id}', { path: { user_id: userId } }),
}
