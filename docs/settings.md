# Settings

Settings is one page with a list of areas down the left. The areas come in two groups:
**You**, which everyone has, and **Server**, which only admins see. If you know what a setting
does but not where it lives, search for it - see [Finding a setting](#finding-a-setting).

---

## You

Your own account and how Grimoire looks and behaves for you. Nothing here changes anything for
anyone else.

| Area            | What's in it                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Account**     | Profile (display name, email), Password & sessions (change password, active sessions), and deleting your account |
| **Preferences** | Language & theme, and Reading & browsing (the reader, how the library lists things, content preferences) |
| **Connections** | Your OPDS feed for e-reader apps, your [API keys](api.md#api-keys), and the [share links](sharing.md) you have made |

API keys and share links only show up when you are allowed to make them.

## Server (admins)

How the whole server behaves. Admins land on **Overview** when they open Settings; everyone else
lands on **Account**.

| Area                 | What's in it                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| **Overview**         | One line each on scanning, backups, sign-in, people, add-ons and Grimoire Codex DB, with a link to the settings behind it |
| **People**           | Users - roles, permissions, passwords, library access grants - and the guests GMs have invited |
| **Access & sharing** | Share links by role, category restrictions, campaign upload limits, and every user's API keys |
| **Sign-in**          | Password sign-in, single sign-on ([OpenID Connect](oidc.md)), guest invite codes, and the login page message |
| **Library**          | Scanning (rescan, watch for changes, scheduled rescan), Files & folders (folder category inference, [folder naming patterns, variant filename rules](filename-rules.md)), Library tools (the [file manager](file-management.md), duplicate detection), and Database Cleanup in the danger zone |
| **Metadata**         | [Grimoire Codex DB](codex.md), the lists the metadata editors offer (genres, system families, parent systems, licenses, dice materials), and [sidecar files](sidecars.md) |
| **Add-ons**          | [Community add-ons](addons.md) and the character content packs installed from them |
| **Sidebar**          | Which sections and stats the sidebar shows to everyone - see [The sidebar](#the-sidebar) |
| **Backups**          | [Backups](backups.md) taken by hand or on a schedule |
| **Logs**             | What the server has been doing, live, filtered by level, user or text |

**Rescan** and **File manager** buttons sit at the top of every Server page, so neither is more
than a click away.

### Where the old tabs went

Settings used to be a row of tabs. Their contents moved like this:

| Old tab        | Now in                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| Account        | Account, Preferences and Connections                                            |
| Users          | People; the share links role switches moved to Access & sharing                 |
| Authentication | Sign-in                                                                         |
| Application    | Sidebar, Access & sharing, and Library → Files & folders (folder category inference) |
| Metadata       | Metadata; folder naming patterns and variant filename rules moved to Library → Files & folders |
| Add-ons        | Add-ons; Grimoire Codex DB moved to Metadata                                    |
| Maintenance    | Library, Metadata → Sidecar files, and Backups                                  |
| Logs           | Logs                                                                            |

Old links such as `/settings/maintenance` still work and open the area that took over.

### The sidebar

**Settings → Sidebar** decides what everyone's sidebar and mobile navigation list.

**Sidebar Visibility** hides a section: **Hide Library**, **Hide Armory**, **Hide Maps**,
**Hide Tokens**, **Hide Audio**, **Hide Models**, **Hide Campaigns** (Characters goes with it),
**Hide Armies** and **Hide Leagues**. A hidden section is only taken out of the navigation -
its pages still open from a link or their address.

Hiding the Library suits a server that holds only wargames: Grimoire then opens on the
[Armory](library-structure.md#the-armory---wargame-books), or, with that hidden too, on the
first of Maps, Tokens, Audio and Models still listed, and on Search when none is. On a phone
the Armory takes the Library's place on the bottom bar. The Armory itself is listed once it
holds a book; until then only admins see it.

Campaigns and Characters sit under a **Role-playing** heading and
[Armies and Leagues](armies.md) under **Wargaming**, with a rule between them. A heading goes
when everything under it is hidden. A campaign's guest sees only the role-playing group, and a league's guest only the wargaming one.

**Sidebar Stats** picks the counts shown at the foot of the sidebar.

---

## Finding a setting

The search box above the list of areas finds any setting by its name or by the words people
usually use for it - "sso" finds single sign-on, "dark mode" finds the theme. Press `/` or
**Ctrl+K** (**⌘K** on a Mac) to jump to it from anywhere in Settings, use the arrow keys to pick a
result, and **Enter** to go there. Grimoire opens the right area, expands the group the setting
is in, scrolls to it and highlights it briefly.

Search only offers what you can use: someone who isn't an admin never sees Server settings in
the results.

## Linking to a setting

Every setting has its own address, `/settings/<area>#<setting>` - for example
`/settings/library#cleanup` for Database Cleanup or `/settings/connections#opds` for your OPDS
feed. Once you have gone to a setting, copy the address from the browser to send someone straight
to it. Opening the link scrolls to the setting and expands its group, the same as a search
result. A link to a Server setting opens your own Account page instead for someone who isn't an
admin.

## Unsaved changes

Most settings save as soon as you change them; a few have a **Save** button. If you try to leave a page with changes you haven't saved, Settings asks before
discarding them.
