# recent-agents

A [zenbu](https://github.com/zenbu-labs/zenbu) plugin that adds a `Cmd+P` command palette to the chat view for switching between recently-used chats — à la VSCode / Obsidian.

## What it does

- Press `Cmd+P` inside a chat view to open the palette.
- Lists chats in MRU order (most recently switched-to on top).
- The top two items are swapped on open, so `Cmd+P Enter` toggles between the last two chats. Spam to flip-flop.
- Live-filter with the search input.
- Navigate with `ArrowUp`/`ArrowDown` or `Ctrl+P`/`Ctrl+N` (emacs style).
- `Enter` switches to the selected chat, `Escape` closes.

## How it works

- A backend `Service` subscribes to `plugin.kernel.windowStates` and diffs `pane.activeTabId` across snapshots. On a tab activation, it prepends the session id to `plugin["recent-agents"].recentSessionIds` (deduped, capped at 100).
- The list is event-driven — nothing is seeded. Entries are only created when a tab is actually switched to.
- A content script is registered into the `"chat"` view scope. It renders a portal modal with a search input, listens for `Cmd+P` globally on the iframe window, and calls the backend `switchToSession` RPC on select. The RPC rebuilds `windowStates` with the new `pane.activeTabId` + `focusedPaneId` + `session.lastViewedAt`.

## Install

```bash
git clone git@github.com:zenbu-labs/recent-agents.git ~/.zenbu/plugins/recent-agents
cd ~/.zenbu/plugins/recent-agents
./setup.sh
```

Add the plugin to `~/.zenbu/config.jsonc`:

```jsonc
{
  "plugins": [
    // ...existing plugins
    "/Users/YOU/.zenbu/plugins/recent-agents/zenbu.plugin.json",
  ],
}
```

Then from the plugin directory:

```bash
zen link
```

Restart zenbu (needed once to pick up the new kyju section; after that everything hot-reloads).

## Known limitations

- `Cmd+P` only fires when focus is inside a chat iframe. On orchestrator/sidebar/other views it does nothing. This is because zenbu doesn't yet expose a global shortcut API — once it does, the binding should move there.
