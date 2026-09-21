# Campaigns

Grimoire has a built-in campaign tracker: characters and sheets, linked resources, a
markdown notes wiki, session scheduling, and calendar export.

---

There are two modes:

- **GM Campaigns** - Created by GMs or admins. Supports player invitations, a banner image (see [Setting images](setting-images.md)), character art and character sheets per member (uploaded file or an external link), resource linking with per-resource visibility, a markdown wiki for notes, and scheduling.
- **Personal Campaigns** - Private to a single user. No sharing.

Campaign creation uses a short wizard: pick a system, then choose resources - the system's core books are suggested by default and anything can be added (with a search) or removed, each set to **Shared with players**, **GM only**, or **Private**. The campaign **description** supports markdown, and you can name a **custom game system** that isn't in your library (handy for keeping notes on a system you don't own).

A personal campaign can be **converted to a group campaign** later (**Convert to group** on the campaign page, GMs and admins only) - useful when solo prep turns into a game you want to run. Everything already in it (resources, wiki, sessions) carries over untouched, and invitations, guests, and scheduling unlock. This is **one-way**: a group campaign can't be turned back into a personal one, since that would strand its members and schedule.

## Archiving campaigns

Finished a game? **Archive** it from the campaign page instead of deleting it. An archived campaign:

- Is **hidden from everyone's campaign list** - yours and your players' - until you switch on the **Archived** toggle above the list, which shows archived campaigns alongside the active ones. It is tucked away, not gone: anyone who was in it can still open it from there.
- Becomes **read-only for everyone, including you**: the wiki, session notes, resources, and roster stay exactly as they were left. Pending invitations to it stop appearing in the invite banner.
- Stays **fully readable** - open it any time to reread notes.

Two things a player can always do, archived or not:

- **Leave the campaign** (**Leave campaign** on the campaign page). Archiving never traps anyone in a game they're done with. The GM removing *someone else* is still a roster edit, so that waits for an unarchive.
- **Export the wiki** (**Export** in the wiki sidebar, then pick a format: Markdown zip, a single Markdown file, or JSON) - so anyone can take their own copy of a campaign with them, including when moving to another platform. Everyone's export contains exactly what they can see in the app: pages they can't read are left out, and `||GM secrets||` are stripped from a player's copy. The page filter applies to the GM too - a player's self-only note isn't in the GM's export any more than it's on their screen - while secrets remain GM-only wherever they sit. Importing writes pages, so it stays GM-only and is unavailable while archived.

Archiving is reversible: **Unarchive** restores writes and puts it back in the normal list. Deleting an archived campaign still works if you want it gone for good.

When a GM invites you to a campaign, an **invite banner** appears at the top of the app so you can **accept** (join the campaign) or **decline** it from anywhere. You can dismiss the banner for the current browser session; it reappears the next time you open the app while an invite is still pending.

Campaign members can set a **character name** per campaign (editable by both the GM and the player), upload **character art** (shown as their avatar) and a **character sheet** (PDF or image). A player can also **create a sheet from a template** - duplicating a form-fillable PDF from the library's Character Sheets category (filtered to the campaign's system) or a campaign file - and **fill it in directly in the app**: the real PDF is rendered in the browser and the player types into the form fields on the page itself, then saves a filled copy. The same in-app editing works for any form-fillable PDF a player uploads, so sheets can be updated as characters advance. Sheets can be downloaded at any time, and re-uploading prompts a warning (with an option to download the current version first) before the previous one is replaced. Users can also set a **display name** in Account Settings that appears in place of their username across the app.

## Per-user campaign access

Each user has a **campaign access** toggle (admins manage it per user in **Settings → Users**; enabled by default). Disabling it does **not** delete any existing campaigns - it only:

- Prevents the user from creating campaigns, being added to new ones, and editing/linking resources.
- Keeps their read access to campaigns they already own or belong to; in member lists they are flagged as **Access disabled**.
- Locks any campaign they **own** to read-only for everyone (players keep view access, lose all edits) until the owner's access is restored.

When OIDC is configured, this flag can be driven by the provider's [permissions claim](oidc.md) (`campaignAccess`); a missing key leaves access enabled.

## Guest invites

Guests let you share a single campaign with people who don't have full accounts - for example a player who's only joining one game. A guest is a code-only account: no password, no OIDC, and no access to the library, maps, tokens, audio, or search. They can only see the campaign they were invited to (and its shared resources, wiki, and schedule), and can edit only their **own** character name, character art, character sheet, session notes, and availability.

- **Enable it server-wide** in **Settings → Authentication → Guest Access**, or pin it with the `GUEST_ACCESS_ENABLED` environment variable. It's off by default.
- **Invite from a GM campaign** - open the members roster and use **Guests** (admins and GMs only). Add a guest with a nickname; each guest gets a unique 10-character invite code. A campaign can have multiple guests.
- **Share the code** with the built-in **Share** button: copy a ready-made message, copy a version for a Discord DM, or open a pre-filled email. The message includes a deep link (`/guest?code=…`) and the code itself.
- **Manage codes** - regenerate a guest's code (invalidating the old one) or remove the guest entirely (which deletes their guest account and contributions).
- **Guests log in** from the login screen via **Have an invite code?**, which works even on OIDC-only servers where password login is disabled. In the app a guest sees the nickname their GM gave them and a **GUEST** role.
- **Admin overview** - **Settings → Users** lists every guest account (grouped separately from full users) with its nickname, the campaign it's attached to, and who invited it. From there an admin can **convert a guest to a permanent user**: give it a username (and a password when password auth is enabled) and it keeps its campaign membership and character.
- **Merge duplicate guests** - someone invited to several campaigns gets a separate guest account for each, with a separate code. Tick the accounts that belong to the same person, choose which one to keep, and **Merge** folds the rest into it: every campaign membership, session note, and character moves across, and the person ends up with one login covering all their campaigns. The merged-away codes stop working; the surviving account's code (or password) is the one they use. The **Account to keep** picker lists both the selected guest accounts and every existing user, so a guest can be folded into the real account that person already signs in with - ticking a single guest is enough to do that.
- **Delete a guest** - remove any guest account outright from the same list, including one left orphaned by its campaign being deleted (it shows with no campaign and no inviter).

## Notes wiki

Each campaign has a full-page markdown **wiki** (opened from the campaign overview) for building out the world - a place for session recaps, lore, NPCs, and plans:

- **Markdown** with tables, images, and the usual formatting, edited side-by-side with a live preview.
- **Visibility per page, for everyone** - every member writes notes at any of three levels, and each level means the same thing relative to whoever wrote the page:
  - *GM only* / *Self only* - visible to its author and nobody else. It reads *GM only* on the GM's pages and *Self only* on a player's, but it's one rule: a player's private note is as closed to their GM as the GM's is to them.
  - *Public* - everyone in the campaign can read **and edit** it, so the party can build a shared knowledge base together rather than only the GM writing into it.
  - *Private* - only the people you pick. A small table lists everyone else in the campaign with a **Can read** and a **Can edit** checkbox each, so you can see at a glance who has what. Ticking *Can edit* ticks *Can read* and locks it, since editing implies reading. A player can share a note with just their GM this way.

  Change it straight from the visibility badge on the page: the badge is a dropdown, and for *Private* pages it lists members so you can grant or revoke access without opening the editor. Only a page's author can change its level or its share list - a public page stays everyone's to edit but its author's to classify. In the sidebar tree, restricted pages carry a small lock-style glyph at the end of their row and read slightly dimmer; *Public* pages show their glyph on hover, and it's clickable to change the level without leaving the list. Visibility is never conveyed by colour alone.

  **Personal campaigns skip all of this.** Nobody else can see them, so there is no level worth choosing: the dropdowns, badges, and row glyphs are simply absent, and every note is private to you. The **My notes** and **Hidden** filters and the **Hide** button go too - they exist to sort your notes from other people's, and alone in a campaign there are none. Convert the campaign to a group one later and those notes stay private until you open them up.
- **Deleting is the author's** - you can only delete a note you wrote, so a player can't delete the GM's notes and the GM can't delete a player's, no matter who can edit it. Anything else you want out of the way, you hide (below).
- **Hide notes you don't need** - hide any note from **your own** view; it changes nothing for anyone else. If the GM keeps fifty pages and you only care about six, put the rest away. Hiding a parent hides its subpages too. The **Hidden** filter under the search box brings them back so you can un-hide them, and **My notes** narrows the tree to the ones you wrote.
- **Multi-select** - Ctrl/Cmd-click notes in the sidebar to select several at once. The note you already have open counts as selected, so ctrl-clicking a second one gives you both; ctrl-click a selected row again to drop it. With a selection active a **Delete selected** button appears; because deleting is author-only, the confirmation spells out exactly what will happen to a mixed selection - "delete 5 notes you created, hide 5 notes you cannot delete" - including how many subpages a hide will sweep along.
- **Custom icons per entry** - give any page (or resource category) its own icon so a long sidebar is easy to scan. The picker is searchable - search by concept, not just name ("tree" finds the pine, "disguise" finds the mask) - and offers a **built-in** set of 200+ icons plus an **emoji** tab. Tint any icon with a preset colour or a custom hex value.
- **GM secrets inline** - wrap text in `||double pipes||` (or use the **GM secret** button) to hide just that span inside an otherwise shared page. This one stays **GM-only**, unlike the visibility levels above: it's a tool for hiding text from players, so it's the GM's on every page, including one a player wrote - annotate a player's session log with notes they'll never see. The GM sees secrets highlighted; players never receive them, stripped on the server before the page is sent. Because a *Public* page is editable by the whole party, a player editing a GM's page can't wipe out secrets they were never shown - they're woven back in where the GM put them when the page is saved. Players don't get the button, and if one happens to type `||` it's kept as ordinary text rather than turning into a secret they'd then be unable to see. (Personal campaigns keep everything, since only you can read them.)
- **Nested pages** - organize the sidebar as a tree: any page can hold subpages, to any depth (a "category" is just a page with children). Drag pages to re-nest them, add a subpage from the parent row, and collapse/expand branches. Deleting a page lifts its subpages up to the parent rather than removing them.
- **Page links** - write `[[Page Title]]` to link pages; missing targets are auto-created as stubs, and each page shows what links back to it. Type `[[` and a **suggestion list** appears, matching page titles as you type (on any word, so `[[gob` finds *Boblin the Goblin*) - pick with the arrow keys and Enter. Links follow their target: **renaming** a page updates the links pointing at it instead of leaving them dangling, and where two pages share a title the suggestions show each one's parent page in brackets - *Ancient Ruins (Northlands)* vs *Ancient Ruins (Southmarch)* - and add a hidden id (`[[Page Title:id-…]]`) so you always link the one you picked.
- **Link to a heading** - suggestions include the headings inside each page, so you can point at a specific section: `[[Bestiary:#Goblins]]` opens *Bestiary* scrolled to its *Goblins* heading. Titles containing a colon (`[[Ancient Ruins: The Depths]]`) and headings starting with `#` (`[[Prices:## of coin]]` for a `# # of coin` heading) work without escaping.
- **Grimoire embeds** - drop a book (optionally at a page), map, token, audio track (plays in the global player; a note with several can be played as a playlist via "Play all"), or campaign file straight into a page. The embed picker lists the campaign's **linked resources** (link new library content in the Resources panel first). You can also **upload an image** right from the picker - it's embedded inline and added to your linked resources, filed under an existing category or a new one you name on the spot (e.g. *NPC art*).
- **Import & export** - the **Export** button offers three formats: a Markdown `.zip` (one file per page with YAML frontmatter - an Obsidian-style vault), a single Markdown file (every page in one document, page titles nested as headings - for reading, printing, or pasting elsewhere), or a JSON bundle. The zip and the bundle re-import; the single file is a read-only snapshot. Importing is GM only, and takes pages from Markdown, a Grimoire JSON bundle, or a **LegendKeeper** export (`.json`, `.lk`, or `.zip` - both the per-page export and the current `{version, resources}` bundle). You can hand it either an archive or the folder itself - **Choose folder** picks a directory of Markdown straight off disk (an Obsidian vault, say) and uploads the whole set in one go, no zipping first; only Markdown is read from it, and a vault's `.obsidian/` is skipped. Either way the folder structure becomes page nesting: `Places/Cities/Waterdeep.md` imports as a Waterdeep page under Cities under Places, with a page created for each folder along the way. If a folder already holds a note standing for it - `Places/Places.md` (Obsidian's folder note) or `Places/index.md` - that note becomes the folder's page instead of a duplicate. A page's own `parent:` frontmatter outranks its folder, so a Markdown zip exported from Grimoire round-trips its tree exactly. LegendKeeper HTML and ProseMirror page bodies are converted to Markdown and the page hierarchy is preserved; LegendKeeper-only block types (e.g. secrets, embeds) are dropped, matching LegendKeeper's own export caveats. Imports are non-destructive - pages are always added, never overwritten.

- **Note templates** (GM only) - **Templates** in the wiki sidebar starts a page from a template instead of a blank one. Templates belong to the campaign and arrive three ways: **downloaded** from a community catalogue (browsed as a collapsible folder tree - Generic first, then a folder per game system, with the campaign's own system opened for you), **written** in the app, or **uploaded** as a `.md` file or a `.zip`. Each is a working copy, so editing a downloaded template never touches another campaign's. Any template **exports** as a `.zip` in the community repo's folder layout, ready to contribute back or keep in your own fork - and that same `.zip` uploads straight back in, so export/upload doubles as copying a template between campaigns. Downloading obeys `DISABLE_EXTERNAL_ADD_ON_INSTALL` - with it set, browsing is off but authoring and upload still work, so you can hand-copy a `.md` from the repo. Picking a template opens an unsaved page editor rather than creating the page, so a mis-click costs a cancel instead of a delete; like every other wiki import it is non-destructive. See [Wiki note templates](wiki-templates.md)

Existing session notes are automatically rolled into wiki pages (nested under a "Session Notes" page) the first time the new version starts; empty notes are discarded.

**Resources** - link books, maps, tokens, and audio, or upload campaign files (handouts, images, etc.) the GM keeps with the campaign. Each resource has a visibility: **Public** (all players), **Private** (shared with specific players - e.g. a handout for 2 of 4), or **GM only**. Resources group under their type by default, but the GM can create custom categories (e.g. *Player Handouts*), drag items between categories and reorder them, and delete categories (keeping items uncategorized or unlinking them). Each group can be **collapsed or expanded** (remembered per campaign), and the GM can **reorder all the groups** - custom categories and the built-in Books / Maps / Tokens / Audio / Files groups together - from the category manager.

Uploaded campaign files live in the data directory, separate from the library. Admins can disable these uploads app-wide or cap them by per-file and per-campaign size in **Settings → App** (admins themselves are exempt).

## Session scheduling

GM campaigns support recurring session schedules:

- **Weekly** - same day(s) every week
- **Biweekly** - every other week (anchored to a reference date)
- **Monthly** - nth weekday of the month (e.g. "first Friday")
- **Custom** - explicit list of dates

Session note stubs are auto-created the day before each scheduled session. Players can mark their availability for upcoming dates, and the GM can cancel individual dates.

## Calendar export

Sessions can go straight into whatever calendar app you already use. The **Calendar** button on a campaign's availability card opens a menu with two options:

- **Download .ics** saves the upcoming sessions as a standard iCalendar file you can import once.
- **Subscription link** gives you a live feed URL. Paste it into Google Calendar ("From URL"), Apple Calendar ("New Calendar Subscription"), or Outlook, and it re-polls on its own - so reschedules and cancellations show up without re-importing. You get two links: one for the campaign you're looking at, and one merging **all** the campaigns you belong to.

The same **Calendar** button sits at the top of the campaigns list, offering just the all-campaigns subscription link.

The subscription link is **personal to you**. It carries its own revocable token - not your password and not your login session - and each event reflects *your* availability: an event reads "Curse of Strahd - Tentative" once you've marked yourself tentative, and a cancelled session shows as cancelled rather than vanishing. Treat the link like a password: anyone holding it can read your session schedule. **Regenerate link** rotates it (instantly breaking the old one, so you'll need to re-subscribe), and **Revoke link** turns the feed off entirely.

> **Accepting or declining in your calendar app won't reach Grimoire.** Subscribed calendars are read-only by design - the calendar standard gives them no way to send anything back - so RSVP buttons on these events either don't appear or do nothing. Every event links back to the campaign's schedule tab, where one click sets your availability.

Subscription links require the `BASE_URL` environment variable to point at the address your server is reachable on, since Grimoire has to hand the calendar app a URL it can actually fetch. Until that's set, the buttons explain what's missing and the one-off **Download .ics** still works.

> **If the link works in Apple Calendar or Outlook but not Google Calendar,** the difference is *who does the fetching*. Apple and Outlook poll from your own computer, so a link that only works on your home network still works for you. Google fetches from its own servers, which means the URL has to be reachable from the public internet over `https://` - a LAN address (`192.168.x.x`), a `.local` name, a Tailscale/VPN-only hostname, or anything sitting behind a login-protected reverse proxy will silently fail there. Paste the `https://` link exactly as shown; Google doesn't understand the `webcal://` form.

Sessions land in your calendar on the day and time you actually picked, in the timezone you picked it in - a Sunday 7:30pm game shows up Sunday at 7:30pm, and stays correct when daylight saving shifts.

> **Evening games used to arrive a day early, and this release fixes it.** Session times were stored in UTC while the weekday stayed local, and the conversion dropped the day it rolled into - a 7:30pm Pacific game became "02:30 UTC" on the same weekday, which is really the *previous* evening. Sunday-night games therefore published as Saturday. Grimoire now stores the day and time together in your own timezone, and existing schedules are repaired automatically on upgrade; nothing to re-enter. Your calendar app picks the fix up on its next refresh, or immediately if you remove and re-add the subscription.

---

## See also

- [Wiki note templates](wiki-templates.md) - starting a page from a template
- [Users and permissions](users-and-permissions.md) - roles, and restricted books in campaigns
- [Setting images](setting-images.md) - campaign banners
