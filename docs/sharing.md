# Share links

A share link is a public URL for one book, map, token, audio track or 3D model. Anyone who has it can open that item - no account, no login - until the link expires or you revoke it. It is how you get a handout to a player who does not use Grimoire, a battlemap into a virtual tabletop, or a track into a Discord channel.

A link opens exactly one item and nothing else. It is not a login and it reveals nothing about the rest of your library.

## Making a link

Choose **Share** from an item's **⋮** menu - on a map, token, audio or model page, on a book in the library, and in the reader for a PDF (other books have a Share button in the reader's toolbar). Give the link an optional label, pick how long it lasts (1, 7, 30, 90 or 365 days, or never), and optionally set a password. The dialog lists every link you have made for that item, with buttons to copy each one or revoke it.

Each link has two addresses:

| Button | Address | Use it for |
| --- | --- | --- |
| **Copy link** | `…/share/<token>` | Sending to a person. It opens a page with a preview, a download button and, if the link has one, a password prompt. |
| **Copy file URL** | `…/api/share/<token>/<file>.png` | Tools that load a file from a URL: a VTT's "import by URL", [OTFBM](otfbm.md), a Discord embed. It is the file itself, and ends in the file's real extension because some tools decide how to read a file from that. |

What the file address serves:

- **Books, tokens, audio and 3D models** - the file. Audio can be seeked.
- **Image maps** - the original image.
- **PDF maps** - the first page, as an image.
- **Universal VTT maps** (`.uvtt`, `.dd2vtt`) - the battlemap image inside them.

A map's OTFBM setup (in its **⋮** menu) makes a special kind of share link: one that serves the map resized to match OTFBM's grid rather than the original image. It is listed with your other links, labelled "OTFBM background", and revoked the same way. See [OTFBM and Avrae](otfbm.md).

### Passwords

A link with a password asks for it on the share page before showing anything - not even the item's name. Once someone enters it, that browser stays unlocked for 12 hours. Changing the password locks everyone out again.

Tools that load the file address directly - VTTs, OTFBM, Discord - have no way to enter a password, so a password-protected link only works on its share page. Leave the password empty for those.

## Taking a link down

**Revoke** stops a link working for good. It stays in your list, marked revoked, until you delete it.

A link also stops working, without anyone touching it, when:

- it reaches its expiry date;
- you are no longer allowed to create share links;
- you can no longer open the item yourself - for example it has been given a higher [access level](users-and-permissions.md), or it is flagged explicit and you have turned explicit content off;
- the item is deleted or its file goes missing.

The middle two are not permanent. The link is *suspended*, not deleted, and works again if your access comes back. Your links, with each one's state, are under **Settings → Account → Sharing**, and you can still revoke them there after losing the right to make new ones.

Anyone opening a link that does not work sees the same "This link doesn't work" page whatever the reason, so a link never tells a stranger whether it expired, was revoked, or points at something you can no longer see.

## Who can make links

Share links are on by default. An admin can turn them off for the whole server with `SHARE_LINKS_ENABLED=false` (see [configuration](configuration.md)): every link stops working and the Share buttons disappear. The links themselves are kept, so turning it back on restores them.

Who may create links is set in **Settings → Users**:

- **By role.** Admins always may. GMs may by default; players may not. The **Share links** panel above the user table turns either role on or off.
- **Per user.** Each user's row has a **Share links** setting - *Follow role*, *Allow*, or *Deny* - that wins over their role either way. Under it is the result, such as "Allowed (from role)" for a GM with no setting of their own.
- **Guests** can never create links.

The same row lists every link that user has made, so an admin can revoke any of them. Turning someone's permission off suspends their links rather than deleting them.

## Things to know

- **Your server has to be reachable.** Whoever opens the link fetches the file from your Grimoire server. For a player on your home network that is fine. For a VTT or OTFBM, which fetch from their own servers, Grimoire must be reachable from the internet at the address set in `BASE_URL`. If an authentication proxy sits in front of Grimoire (Authelia, Authentik's proxy, Cloudflare Access), let `/share/` and `/api/share/` through without it, or links will hit the proxy's login page instead.
- **Links are capabilities.** Anyone who has the URL can use it, and URLs get forwarded. Use an expiry for anything you would not want passed around, and a password for anything a person (not a tool) will open.
- **Tokens are kept**, not hashed, so you can copy a link again from your list later. Revoke a link you think has leaked.
- **Repeated guessing is throttled.** Requests for links that do not exist count against the same rate limit as logins, per address. A link that was revoked or expired does not count, so a tool that keeps fetching a dead link cannot lock out the working ones.

For the endpoints behind all of this, see [Share links in the API reference](api.md#share-links-1).
