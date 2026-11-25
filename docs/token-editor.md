# Token editor

Turn any picture into a VTT-ready token without leaving Grimoire - and without writing
anything into your library.

---

Turn any picture into a VTT-ready token without leaving Grimoire. Open it from the
**Token editor** button on the tokens page, from a token's own page, or - the quickest
route - from a character's portrait in a campaign's member list.

Load art by uploading a file, pasting from the clipboard, dropping it on the page, or
browsing what Grimoire already holds. Browsing offers your token library and nothing else -
book covers, album art, and battlemaps are none of them a character portrait, and tokens are
already the collection of character images. Anything filed elsewhere is still one upload
away. Then position it: drag to move, scroll to zoom,
`Shift`+scroll to rotate, and the arrow keys to nudge a pixel at a time. On a touchscreen,
drag with one finger and pinch or twist with two. Double-click (or press `R`) to start over.

You choose a frame, the output size (140, 256, 512, or 1024 pixels), and an optional
background colour behind transparent art. The frame decides the token's shape - pick an
ornate border and the art is cropped to its opening. For a plain round or square token with no
visible border, pick the circle or square frame and set its colour to **None**: the shape still
does the cropping, it just draws nothing. With no frame at all you get the full square image.
The finished token is a PNG with real transparency.

**Two ways out.** **Download** saves the PNG to your device, ready to drop into Roll20,
Foundry, or anything else. **Send to a campaign** offers whichever of two destinations you
have the standing for:

- **Send to a character** - the games you play in, one row per character. It becomes that
  character's VTT token, kept separately from their portrait so making a token never
  overwrites their artwork. Because setting your own character's things has always been
  something a player can do, players can make their own tokens, not just GMs.
- **Send to a campaign you GM** - one row per campaign rather than per character, so running
  four games does not bury them under twenty characters. Pick a campaign and you then choose
  either **Set as a character token** - which lists just that campaign's characters - or a
  resource category, defaulting to the built-in **Tokens** group. In a personal campaign, the
  character list starts with **your own token**: you have no membership in a campaign you
  run, so that token is kept on the campaign, and your character sheet's portrait is never
  touched.

You are only shown the paths that apply to you: a player with no campaign of their own never
sees the GM route, and someone in no campaigns at all is told so rather than offered a
destination that would be refused.

Opening the editor from a character's portrait is the exception - it already knows who the
token is for, so the button simply sets that character's art.

**Tokens on the campaign page.** Each player's token sits beside their art in the member
list, and a personal campaign shows **Your token** on its Characters card. Click the token to
download it for your VTT. Whoever may set it - the player themselves or the campaign owner,
and only you for your own token in a personal campaign - also gets **Make a new token** and
**Remove**, or **Make a token** while there is none. Making one from there opens the editor
already bound to save it as that token, not as art.

**Changing a token later.** Every token you save - to a character, to yourself in a
personal campaign, or into a campaign's resources - keeps how it was made: the art, the
frame and its colour, the background, the size, and where you placed and turned the art.
**Edit token** (on a character's token, or the wand on a token in the resources list)
opens the editor exactly as you left it, and saving writes the new version over the old -
a token in the resources keeps its place, category and visibility. Art from your device is
kept with the token for this, and counts as a campaign upload: it takes up room in the
campaign's storage limit and follows the admin's other upload limits, so a token whose art
does not fit is not saved. Art from your library is read from the library, and if it
has gone since, the editor keeps the frame and colours and asks for new art. While editing
one destination you can still **Send to a campaign** to save a copy somewhere else.
Tokens made before this, and tokens only ever downloaded, have nothing to reopen.

Nothing is written to your library and no new token is added to it: the image is composed in
your browser and only leaves by one of those two doors. That means the editor works fine on
a read-only library, and never disturbs a scan.

**Frames.** Five ship with Grimoire. Two are plain shapes - a circle and a square - which
take any colour you pick, and three are themed role markers (player
character, non-player character, opponent) that keep their own colour, since that colour is
part of telling them apart at a glance. You can add your own as well. Mark any folder under `tokens/` as a frame folder - right-click
it in the [file manager](file-management.md) and choose **Mark as frame folder**, or
tick the box when creating it - and every PNG, WebP, or SVG inside becomes a frame. (That
writes an empty `.frames-container` file, which you can equally create by hand.) The folder keeps a
normal name - `Fantasy Frames`, `Scifi Frames` - and the picker groups frames under it, so
a system's frames can sit beside that system's tokens.

Frame images are still indexed as ordinary tokens and appear in your token gallery. That is
deliberate: a frame *is* a token image, just one you would normally composite rather than
place on a map. Add a [`.grimoireignore`](library-structure.md#ignoring-files-with-grimoireignore) rule if you
would rather they stayed out of the gallery. Both the tokens page and
[in-app file management](file-management.md) badge a folder holding the marker with
**Frames**, at whatever depth it sits, so you can see which folders feed the editor.

**Finding a frame.** A large collection stays manageable: the frame list scrolls in place
rather than pushing the page down, each folder group collapses, and a search box filters by
frame name or folder. Favouriting a frame is the same as favouriting anything else - star it
in your token gallery, and it appears in a **Favourites** group at the top of the picker. It
stays listed under its own folder too, so a frame never moves out from where you filed it.

Hovering a frame shows it **enlarged beside the list**. A picker tile is small enough to fit
a few hundred frames on screen but too small to judge one by - the thing that decides between
two ornate borders is the detail in the border - so the tiles stay small and a hover shows the
frame at a size you can actually read.

**Frames that are versions of one another.** A frame folder often holds the same ring more
than once: a black-and-white cut beside the colour original, a thinner weight, a recoloured
set. Link them in [duplicate detection](file-management.md#duplicates-and-multiple-versions) the way you would
any other file, and the picker shows **one tile** for the frame rather than the same ring
several times over. Selecting it lists its versions in the space the colour swatches occupy
for the built-in shapes - the two never both apply, since a frame from your library is a file
and takes no colour - each named the way versions are named everywhere else ("Black and
white · v2"). Picking one keeps the frame's own tile lit, so stepping back to the original is
one click.

**Choosing which version of your art to frame.** The same applies to the picture you are
turning into a token. When the image you pick from your library has other versions, they are
offered under it and you choose which one the token is made from - the colour portrait or its
black-and-white cut are different tokens, and which one you want is not a detail Grimoire
should pick for you.

The editor reads a frame's crop **from the frame itself** - it fills inward from the centre
and keeps whatever the frame encloses - so a frame can be any shape, and the art follows its
real outline rather than a circle. The one requirement is that the outline be **closed**: a
border with a gap in it lets the fill escape, and the editor falls back to a plain circular
crop. (That is why the bundled non-player-character frame bridges its decorative notch with a
small bar.) Frames should be square overall, with a transparent middle, and for SVGs you must
set explicit `width` and `height` attributes alongside the `viewBox` - Firefox and Safari
cannot draw one without them. The bundled frames use a `0 0 512 512` viewBox and are worth
copying as a starting point.

## See also

- [Universal VTT editor](uvtt-editor.md) - the same idea, for battlemaps
- [Library structure - tokens](library-structure.md#tokens---organize-by-type) - where token art and frame folders live
