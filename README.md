# mcp-notify

Minimal MCP server that plays a **notification sound** and shows a **system banner** on your computer whenever your AI agent finishes a task or needs your attention.

Works with any MCP client: Claude Desktop, Claude Code, Cursor, VS Code, opencode, Cline, and more. One 3-line config, no API keys, no network calls — it only touches your local audio and notification facilities.

## Install

Add to your client's MCP config (Claude Desktop `claude_desktop_config.json`, Cursor / VS Code `mcp.json`, or opencode config):

```json
{
  "mcpServers": {
    "mcp-notify": {
      "command": "npx",
      "args": ["-y", "@mrfqcentic/mcp-notify"]
    }
  }
}
```

(opencode users: same shape under the `mcp` key with `"type": "local"` and `"command": ["npx", "-y", "@mrfqcentic/mcp-notify"]`.)

Requires Node.js >= 20.

## Make the agent call it

Add one line to your `AGENTS.md` / `CLAUDE.md` / system prompt:

```
When a task is done or the user should be alerted, call the `notify` tool with a short title and a 1–2 sentence description of the result.
```

## Tools

### `notify`

Plays the sound and shows a banner. The agent always supplies `title` (max 50 chars) and `message` (max 200 chars).

| Param | Required | Description |
|---|---|---|
| `title` | yes | Short banner title, e.g. "Build finished" |
| `message` | yes | 1–2 sentence description, e.g. "All 142 tests passed" |
| `sound` | no | Absolute path to any audio/video file with audio (mp4, m4a, mp3, wav, aiff) |

### `list_sounds`

Lists available sounds and the currently selected default.

## Choosing your sound

Resolution order:

1. `NOTIFY_SOUND` env var — absolute path, explicit and deterministic
2. A file in the `sounds/` folder whose name starts with `default` (your pin)
3. First audio file in the `sounds/` folder (alphabetical — `notify-me.mp3` ships here as the bundled default)
4. The generated chime in `assets/`
5. The system sound (macOS `Glass.aiff`, Linux `bell.oga`)

Tip: rename or copy your favorite sound to `sounds/default.mp3` (or set `NOTIFY_SOUND`) to make it stick.

The bundled `sounds/notify-me.mp3` was generated with [ElevenLabs](https://elevenlabs.io) under a commercial license.

```json
{
  "mcpServers": {
    "mcp-notify": {
      "command": "npx",
      "args": ["-y", "@mrfqcentic/mcp-notify"],
      "env": { "NOTIFY_SOUND": "/absolute/path/to/your-sound.mp3" }
    }
  }
}
```

Tip: MP4 files with an audio track work too (macOS `afplay` reads the audio stream).

## Platforms

| OS | Sound | Banner |
|---|---|---|
| macOS | `afplay` (tested) | `osascript` (tested) |
| Linux | `ffplay` / `mpg123` / `paplay` / `aplay` fallback chain (best effort) | `notify-send` (best effort) |
| Windows | PowerShell `MediaPlayer` (best effort) | PowerShell `NotifyIcon` balloon (best effort) |

Any `CI` env value makes sound and banner playback no-ops (set automatically in CI workflows) so the test suite can run on machines without audio.

## Development

```sh
npm install
npm run typecheck
npm test          # builds, then runs the e2e suite (sound + banner fire locally)
```

## License

MIT — see [LICENSE](./LICENSE).
