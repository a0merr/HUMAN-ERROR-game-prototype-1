# HUMAN ERROR — desktop (Tauri v2)

Steam needs an executable; the game is a browser app. This directory wraps it
in a Tauri v2 shell. The web repo stays zero-dependency — everything desktop
(npm dev deps, Rust) lives here.

What the wrapper does:

- **Launcher** (`src/launcher.html`) — unified SOLO / ONLINE menu.
- **Solo** — fully offline: `index.html`, `client/`, `engine/` are bundled as
  app assets (`scripts/make-dist.mjs` copies them into `dist/`).
- **Online** — navigates the webview to the deployed server (set at build time
  via `GAME_SERVER_URL`), so multiplayer works exactly like the browser build.
  Unreachable server shows a clean error state and Solo keeps working.
- **Clips / screenshots** — saved to the OS Videos / Pictures folders (under
  `HUMAN ERROR/`) via the `save_media` command; the game toasts the saved path.
  All platform calls go through `client/platform.mjs` (`isDesktop()`, `save()`,
  `openUrl()`), so steamworks.js can drop in later without touching game code.

## Build (Windows first)

Prereqs: Node 18+, Rust (stable), WebView2 runtime (preinstalled on Win 11).

```powershell
cd desktop
npm install                                   # @tauri-apps/cli (dev-only)
$env:GAME_SERVER_URL = "https://your-deploy.example"
npm run tauri build                           # NSIS installer + .exe
# artifacts: src-tauri/target/release/human-error.exe
#            src-tauri/target/release/bundle/nsis/*.exe
```

Dev loop:

```powershell
npm run tauri dev
```

Notes:

- `scripts/gen-icons.mjs` writes placeholder icons — swap for real art before
  Steam upload.
- Steamworks (achievements / overlay / invites) is deferred; integrate by
  extending `client/platform.mjs` + `src-tauri/src/lib.rs` only.
