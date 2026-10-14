# OTFBM and Avrae

[OTFBM](https://otfbm.io) (On The Fly Battle Maps) draws battle maps as images for play-by-post games, most often through [Avrae](https://avrae.io)'s `!map` command on Discord. Any image map in your library can be set up for it: open the map, then **⋮ → Set up for OTFBM (Avrae)**. The option is there for anyone allowed to create [share links](sharing.md), since that is how OTFBM gets the picture.

## Why the image needs resizing

OTFBM draws your picture at its real size and lays its own grid over the top, at a cell size you choose with `-options c<size>`. It does not stretch the picture to fit. So a typical battlemap, drawn at 140 pixels per square, sits under OTFBM's default 40-pixel grid and lines up with nothing. Getting the two to match by hand usually means trial and error.

Grimoire already knows the map's grid, so it resizes the image until each of the map's squares is exactly the cell size, serves that resized image through a share link, and gives you the matching command:

```
!map -mapsize 33x24 -options c70 -bg https://grimoire.example.com/api/share/…/tavern-33x24c70.jpg
```

## Using it

1. **Pick a square size.** OTFBM accepts 20 to 100 pixels. Grimoire suggests 70, or the map's own square size if that is smaller, since enlarging a picture adds file size without adding detail. The dialog shows the resulting grid and image size as you change it.
2. **Create the share link.** Choose how long it should last - *never* is the default, because a play-by-post battle can run for weeks and OTFBM fetches the background every time the map is drawn. If you already made a link for this map at the same square size, it is reused instead.
3. **Copy the command** and run it in Discord.

The link is an ordinary share link that serves the resized picture instead of the original. It is listed under **Settings → Account → Sharing** as "OTFBM background", and revoking it there takes the background down. Nothing is written to your library.

If your Grimoire is not reachable from the internet, OTFBM cannot fetch from it. The dialog also lets you **download the resized image** to host somewhere else - OTFBM keeps a list of [image hosts that work](https://docs.otfbm.io/#/pages/image-hosts) - and you then put that URL after `-bg` yourself. The download is a JPEG, or a PNG if the map has transparent areas; OTFBM does not read WebP.

## Getting the grid right

The setup uses the same grid as the [Universal VTT export](uvtt-editor.md): the grid you set by hand if there is one, otherwise the one detected from the filename or image, otherwise 140 pixels per square. If the dialog says no grid was found, or the squares do not line up in OTFBM, correct the grid in the map's details first. The link always serves the map at its current grid, so after correcting it, open the dialog again for the updated command.

Some details:

- **Partial squares.** Maps often have a fraction of a square of margin past the grid. A map that measures 33.25 squares across becomes a 33-square OTFBM map, with the margin still in the image.
- **Large maps.** OTFBM shows at most 99 squares per side. A bigger map is capped at 99, and the dialog warns that its far edge will be cut off.
- **Universal VTT files.** A `.uvtt` can be set up too, using the picture inside it and its own grid.
- **Offsets.** If a map's grid does not start at its top-left corner, OTFBM's background offset option (`-options o<x>:<y>`) can shift it. Grimoire does not set this for you.
