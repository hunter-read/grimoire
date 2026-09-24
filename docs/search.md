# Searching your library

The search box looks in two places at once: the **text inside your books**, and the
**books, maps, tokens, audio, and models themselves**. Typing `Avatar` turns up the book
*Avatar Legends Core Rulebook* at the top of the results - with its cover, and no page
numbers, because it is the book itself that matched - followed by every page that happens
to mention the word.

---

## Searching one field at a time

Put a field name and a colon in front of your search to look in just that field:

```
title:avatar                 books whose title contains "avatar"
author:"Gary Gygax"          quotes keep a phrase together
system:pbta category:core    both must match
tag:forest tag:swamp         either tag matches
year:2015-2020               a range; year:>2015 and year:<=2020 also work
text:fireball                page content only
```

The full list, with the alternative spellings each one accepts:

| Field | Also accepts | Searches |
|-------|--------------|----------|
| `title` | `name` | Book titles, map/token/model filenames, audio track titles |
| `author` | `authors` | Book authors |
| `artist` | `artists` | Book artists, audio artist |
| `publisher` | | Publisher |
| `system` | `game` | Game system |
| `category` | | `core`, `supplement`, `adventure`, … |
| `tag` | `tags` | Tags on books, maps, tokens, and audio |
| `year` | | Publication year, or a range |
| `isbn` | | ISBN |
| `code` | `sku`, `product_code` | The publisher's product code (`code:PZO9001`). Spaces and hyphens are ignored, so `TSR9247` finds `TSR 9247` |
| `language` | `lang` | Language |
| `description` | `desc` | Book description |
| `album` | | Audio album |
| `filename` | `file` | The name on disk |
| `text` | `content`, `page` | Page content |

Three things worth knowing:

- **A field search skips page content.** `title:avatar` looks only at titles, which
  is the whole point - it is how you check whether you own a book without wading
  through every page that mentions it. Use `text:` when you want page content back.
- **Fields combine.** Several different fields all have to match; the same field
  repeated matches any of its values.
- **Colons in titles are safe.** Searching `Vaesen: Nordic Horror` looks for that
  text rather than treating `Vaesen:` as a field, so you never have to think about
  the syntax unless you want it.

The **(i)** button in the search box lists the fields with examples, and clicking
an example runs it.

## See also

- [Library structure](library-structure.md) - what is indexed and how tags are applied
- [Performance](performance.md) - OCR, and why a scanned book may not be searchable yet
