---
name: run-game
description: Launch and visually verify HUMAN ERROR (solo + multiplayer) in a real headless browser. Use when asked to run the game, screenshot it, or confirm a change works in the actual app (not just headless sim tests). Boots the Node server, drives both modes with Playwright, asserts the canvas rendered and the player got a role.
---

# Run & verify HUMAN ERROR

The game is native ES modules, so it must be served over `http://` (not
`file://`). Both modes run through the bundled zero-dep Node server.

## 1. Start the server (background, poll the port — don't `sleep`)

```bash
PORT=8123 node server.mjs > /tmp/he_srv.log 2>&1 &
echo $! > /tmp/he_srv.pid
timeout 20 bash -c 'until curl -sf http://localhost:8123/solo >/dev/null; do sleep 0.3; done'
```

Routes: `/solo` = solo wave-roguelite, `/` = multiplayer lobby.

**Stop it — and kill zombies.** Stale `server.mjs` processes hold the port and
the next boot silently answers from the OLD code (this has burned us). Always:

```bash
kill $(cat /tmp/he_srv.pid) 2>/dev/null
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*server.mjs*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
```

## 2. Drive both modes (Playwright)

Playwright is intentionally NOT a project dependency. Install once in a throwaway
dir, then run the in-repo smoke script against the running server:

```bash
SD="$TMPDIR/he-pw"; mkdir -p "$SD"
(cd "$SD" && npm i playwright >/dev/null 2>&1 && npx playwright install chromium)
NODE_PATH="$SD/node_modules" PORT=8123 OUT="$SD" node test/browser-smoke.mjs
```

`test/browser-smoke.mjs` clicks DROP IN (solo) and Create Room → Start (mp),
then asserts: canvas renders >30 distinct colors (a blank frame = launch
failure), solo timer counts down, mp player gets a HUNTER/HIDER role, and zero
console/page errors. Screenshots land in `$OUT/solo-play.png` + `$OUT/mp-play.png`.

## 3. Look at the screenshots

A passing assertion isn't enough — open `solo-play.png` and `mp-play.png`. Expect
a crowd of identical figures, pillars, a ringed "YOU", and (solo) a hunter vision
cone / (mp) a red hunter with a tag reticle. Map + skin are randomized per match,
so they'll differ between runs.

## Gotchas hit before

- `attach()`/builder methods must `return this` — a missing return makes the
  whole module throw at the first chained call and the canvas stays blank.
- Server player ids vs engine agent ids are separate counters; the human body
  must be stamped with the network id or the mp client can't find "me".
- Single-player mp correctly makes that one player the **Hunter**.

## Fast non-visual gate

For logic-only changes, `npm run check` (syntax + `test/headless.mjs`) runs the
shared sim under Node for both modes — no browser needed.
