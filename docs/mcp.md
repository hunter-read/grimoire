# MCP server (AI assistants)

Grimoire can act as an [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server, so
an AI assistant such as Claude Code can work with your library while it answers you - "how does
grappling work in this system?", "which of my books has a fire drake in it?", "help me prep
Thursday's session" - and cite the book and page it found the answer on.

It is **off by default**. When it is on, it uses the same [API keys](api.md#api-keys) as the REST
API, so an assistant only reaches what its key allows, and only what the key's owner could see in
the app: restricted books stay hidden, and a player never gets the GM's private notes.

---

## Enabling the MCP server

Set `MCP_ENABLED=true` in your compose file and restart:

```yaml
environment:
  MCP_ENABLED: "true"
```

API keys must be on too (`API_KEYS_ENABLED`, on by default). With keys off, the MCP server
refuses every request and Grimoire logs a warning at startup.

## Connecting an assistant

1. **Create an API key** in Settings → API keys. Admins can always hold keys; anyone else needs
   an admin to turn keys on for them in Settings → Users. Pick the permissions for what you want
   the assistant to do (see [What it can do](#what-it-can-do)) - **Read** on Search, Books, Game
   systems and Campaigns covers everything read-only. Once MCP is on, the dialog that shows your
   new key also shows the command to connect Claude Code with it.
2. **Add the server to your assistant.** For Claude Code:

   ```bash
   claude mcp add --transport http grimoire https://grimoire.example.com/mcp \
     --header "X-API-Key: grim_..."
   ```

   Then run `/mcp` inside Claude Code to check it shows `grimoire` as connected.

Any MCP client that supports the Streamable HTTP transport and custom headers can connect the
same way: the URL is your instance's address plus `/mcp`, and the key goes in `X-API-Key`.

## What it can do

An assistant is only shown the tools, resources and prompts its key can use.

### Tools

The assistant decides when to call these.

| Tool                 | Key permission      | What it does                                                                                                    |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `search_library`     | Search: Read        | Full-text search across your books - the same search as the search box, `title:`/`author:`/`tag:` filters too   |
| `list_game_systems`  | Game systems: Read  | Your game systems and how many books each has                                                                   |
| `list_books`         | Books: Read         | Your books by title, optionally one system or category                                                          |
| `get_book`           | Books: Read         | A book's details and its table of contents with page numbers                                                    |
| `read_pages`         | Books: Read         | The text of up to 10 pages                                                                                      |
| `view_page`          | Books: Read         | A page as an image, for maps, stat blocks and tables                                                            |
| `list_campaigns`     | Campaigns: Read     | The campaigns you run or play in                                                                                |
| `get_campaign`       | Campaigns: Read     | A campaign's description, players, and an outline of its wiki, including dated session notes                    |
| `read_wiki_page`     | Campaigns: Read     | One wiki page                                                                                                   |
| `search_campaign_wiki` | Campaigns: Read   | The wiki pages that mention a name or phrase                                                                    |
| `create_wiki_page`   | Campaigns: Write    | Adds a new wiki page, private to you. Never changes existing pages                                              |
| `add_bookmark`       | Personal: Write     | Bookmarks a page in your own bookmark list                                                                      |
| `tag_books`          | Books: Write, GM+   | Adds tags to books; existing tags are kept                                                                      |

The write tools only ever add things. Claude Code asks you before it runs any MCP tool, unless
you have allowed that tool.

A page an assistant writes is always private to you, and so is any page its `[[links]]` create.
To show it to your table, open it in the campaign wiki and change who can see it there. A campaign
that is archived, or whose GM has campaign access turned off, takes no new pages.

### Resources

Content you attach to the conversation yourself - in Claude Code, type `@grimoire:` and pick one.

| Resource                                           | Key permission  |
| -------------------------------------------------- | --------------- |
| `grimoire://campaigns/{campaign_id}` (listed)      | Campaigns: Read |
| `grimoire://campaigns/{campaign_id}/wiki/{page_id}` | Campaigns: Read |
| `grimoire://books/{book_id}`                       | Books: Read     |

### Prompts

Ready-made requests you start yourself - in Claude Code, as slash commands.

| Prompt                 | Key permission  | What it starts                                                                                                |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| `prep_session`         | Campaigns: Read | `/mcp__grimoire__prep_session ember` - plans your next session from the campaign's notes and wiki             |
| `answer_from_my_books` | Search: Read    | `/mcp__grimoire__answer_from_my_books` - answers your rules and lore questions from your books, with the page |

`prep_session` takes **one word** from the campaign's name - Claude Code passes only one word per
argument - and offers your campaign names as you type. Leave it out, or type a word that matches
more than one campaign, and the assistant asks you which one you mean. `answer_from_my_books`
takes no argument: start it, then ask your questions.

## How it works

MCP is a JSON-RPC 2.0 protocol rather than a REST API. Every message is a `POST` to the single
`/mcp` endpoint. The assistant first calls `initialize`, then `tools/list` to learn which tools
exist - each with a description written for the model and a JSON Schema for its arguments - then
`tools/call` to run one. Resources and prompts work the same way (`resources/list`,
`resources/read`, `prompts/list`, `prompts/get`).

Grimoire answers each `POST` with one JSON body and keeps no session, so it works behind any
reverse proxy that passes `POST` requests through. `GET` and `DELETE` on `/mcp` (a
server-to-client stream and session teardown, both optional in the spec) return `405`.

The protocol is handled by the official [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk), so Grimoire speaks whatever revisions it supports: currently `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`.

## Troubleshooting

- **`401`** - the key is missing, wrong or expired. Check the header name is exactly
  `X-API-Key`. Some clients react to a `401` by starting an OAuth sign-in, which Grimoire does not
  offer; fix the key rather than following that prompt.
- **`403` "API keys are disabled on this server"** - set `API_KEYS_ENABLED=true`.
- **`403` "API keys are not enabled for your account"** - an admin needs to turn keys on for
  you in Settings → Users.
- **The assistant is missing a tool** - the key lacks the permission it needs (see the tables
  above), or, for `tag_books`, your account is a player.
- **`/mcp` returns the Grimoire web page, or `405` for `POST`** - `MCP_ENABLED` is not set.
- **`406 Not Acceptable`** - the client's `Accept` header excludes `application/json`. MCP clients send `application/json, text/event-stream`; a script calling `/mcp` directly should send that, or `*/*`.

## See also

- [API reference](api.md#api-keys) - API keys and their permissions
- [Configuration](configuration.md) - `MCP_ENABLED`
