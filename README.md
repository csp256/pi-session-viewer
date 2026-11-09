# Pi Session Viewer

[English](README.md) | [简体中文](README.zh-CN.md)

A local, read-only web inspector for [Pi](https://github.com/earendil-works/pi) coding-agent sessions. Visualizes multi-turn timelines, tool-call causality, and captured system prompt compositions.

![Pi Session Viewer Screenshot](https://raw.githubusercontent.com/hfrancisla/pi-session-viewer/main/assets/gallery-preview.webp)

## Install

```bash
pi install npm:@hfrancisla/pi-session-viewer
```

Restart Pi or run `/reload`. The extension loads automatically and begins capturing system prompts on the next turn.

Pi loads the backend through a TypeScript entry so `/reload` picks up backend changes instead of reusing Node's cached compiled ESM. For local checkout updates, run `npm run build`, then `/reload` and `/session-viewer on`; use the newly opened viewer tab.

## Usage

```text
/session-viewer       # Start viewer (alias for on)
/session-viewer on    # Start viewer and open in browser
/session-viewer off   # Stop viewer (system prompt capture continues)
```

- Starting the viewer opens a local tokenized dashboard in your browser.
- Session switches (`/new`, `/resume`, `/fork`) require running `/session-viewer on` again.
- Discover sessions directly from Pi's storage or import any `.jsonl` session file via the browser.
- Saved session names are indexed before opening sessions. The first catalog scan reads each file once; later scans reuse a persistent index and read only appended data. The local metadata cache lives under `~/.pi/agent/cache/pi-session-viewer/session-names` (or `PI_CODING_AGENT_DIR`), and can be relocated with `PI_SESSION_VIEWER_CACHE_DIR`. Deleting it safely rebuilds the index; cache write failures fall back to memory.
- On desktop, drag either sidebar divider to resize it. Widths are remembered for the viewer's origin. Use arrow keys (Shift for larger steps), Home/End for width limits, or double-click a divider to reset that sidebar.
- The interface defaults to English unless your browser's primary preferred language is Chinese. A language selected with the EN/中 button takes precedence and is remembered.
- The viewer defaults to dark mode. Use the sun/moon button between the language toggle and refresh button to switch themes; your browser remembers the choice for the viewer's origin.

## Key Features

- **Timeline order**: Toggle Oldest first / Newest first in the central pane. The choice is remembered; selection and filters stay unchanged.
- **Reading view**: Double-click a timeline event for a large, scrollable Markdown/text modal. Use the book button or Shift+Enter as alternatives; switch to source text when needed. Close with Escape, the close button, or the backdrop.
- **Timeline & Causality**: Starts with only User and Pi Response events visible. Enable thinking, tool calls/results, and other event types with the filters to inspect their visual causality rails.
- **System Prompt Breakdown**: Inspects prompt structure across base instructions, tool definitions, skills, and context files.
- **Multi-Project Catalog**: Groups sessions by project working directory with automatic path collision disambiguation.
- **Local JSONL Import**: Inspect arbitrary session files offline via file drag-and-drop.

## Security & Privacy

- **Local Only**: Listens strictly on `127.0.0.1` with a per-instance random bearer token. No cloud sync, telemetry, or remote access.
- **Read-Only**: The web interface cannot mutate sessions or execute commands.
- **Capture Scope**: Saves system prompts, skill metadata, and context file snapshots to local session files. Does **not** record API keys, request headers, or credentials.
- **Historical Sessions**: Turns without an associated system-prompt capture record display as *unrecorded*; the reason is not inferred, and past prompts are never reconstructed from current configuration.

## Development

```bash
npm install
npm run dev        # Web dev server
npm test           # Unit & integration tests
npm run build      # Build web assets and extension bundle
npm run verify     # Full verification suite
```

Session directory resolution order: `PI_CODING_AGENT_SESSION_DIR` → `~/.pi/agent/settings.json` → `~/.pi/agent/sessions`.
