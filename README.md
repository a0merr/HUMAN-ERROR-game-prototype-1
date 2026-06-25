# HUMAN ERROR — playable prototype

> *One of them is real.*

A multiplayer **hide-in-the-crowd** party game. A map is packed with identical AI NPCs running looping routines. A few humans are dropped in wearing the same skin; one is the **Hunter**. Hiders survive by *acting fake* — mimicking the NPCs. Humans always out themselves by being too human: sprinting, panicking, fumbling a glitch event, doing a too-perfect dance. A reverse Turing test as a party game — instantly legible, inherently funny, meme-ready.

This repo is a working, end-to-end **prototype** built to prove the joke (the deck's weeks 1–3 gate: *"if it isn't funny with friends, kill it cheap"*).

---

## Architecture — one engine, two modes

The whole game is a **unified, zero-dependency ES-module engine**. The solo game
and the authoritative multiplayer server import the *same* simulation code, so
the crowd, NPC routines, bot slips, glitches, collision and line-of-sight behave
identically everywhere — fix a bug once, it's fixed in both.

```
engine/      shared, DOM-free sim (runs in browser AND Node)
  math.mjs        clamp/dist/angles + seeded Mulberry32 RNG (deterministic)
  config.mjs      maps, pillar layouts, skins, perks, glitches, tunables
  geometry.mjs    collision, line-of-sight, vision cones, spawning
  agents.mjs      NPC routines, dumb-human "slips", glitch reactions, humanScore
  hunter.mjs      AI Hunter targeting + inspection creep
  sim.mjs         CrowdSim — the shared orchestrator both modes build on
client/      browser presentation
  render.mjs      canvas renderer + particles
  audio.mjs       generated WebAudio sfx (no asset files)
  input.mjs       keyboard → movement intent
  hud.mjs         overlay / meter DOM glue
  solo.mjs        SOLO entry: waves, perks, suspicion, kill-cam
  mp.mjs          MULTIPLAYER client: snapshot interpolation
server.mjs   zero-dep Node server: raw WebSocket + rooms, drives a CrowdSim
test/headless.mjs  runs the sim under Node for both modes (npm run check)
index.html / mp.html   solo / multiplayer pages
```

**Solo** — wave roguelite (`/solo`)
- Endless waves: survive 40s, clear, pick a stacking **perk** (8 of them), repeat.
- **1 → 4 AI Hunters** scan a LOS cone, lock the most *human-looking* body, creep in to inspect — purely on **behavior**, never identity.
- **Blend**: match crowd pose/speed, hold Shift for NPC-speed walk, use cover. Sprint or break from the crowd → suspicion spikes.
- **4 glitch events** (alarm / cash / freeze / crowd-wave), **dumb-human bots** that visibly slip, **kill-cam**, **score + best run** saved locally. Maps rotate per wave.

**Multiplayer** — one Hunter vs hiders (`/`)
- **Server-authoritative** 20Hz CrowdSim; raw hand-rolled WebSocket, **no npm install**.
- **Quick Play** matchmaking + **private rooms** with server-minted codes (capacity-capped).
- One random human is the **Hunter**; the rest blend into the AI crowd + slipping bots. Hunter presses **Space** to tag the body in front — catch a human/bot, or whiff an NPC and get **stunned**.
- **3 maps** (Plaza / Atrium / Stacks) + crowd skins + **taunt emotes** (1–4), kill-cam, screen flash, **"HUMANS LEFT: N"** stakes, killfeed, juice.
- **LAN** out of the box; **internet** via one tunnel command.

---

## Run it

See **[RUN.md](RUN.md)** for full instructions. ES modules need `http://`, so both
modes run through the bundled server (no more double-clicking a file).

```bash
npm start              # starts server, prints localhost + LAN URLs
# Solo:        http://localhost:8080/solo
# Multiplayer: http://localhost:8080/
npm run check          # syntax-check + headless engine tests
npm run tunnel         # public internet link (second terminal, no account)
```

**Controls:** WASD move · Shift slow-walk · F dance · 1–4 taunt · Space tag (Hunter) · Q decoy (solo perk) · P screenshot.

---

## Status vs. the 90-day plan

| Deck milestone | This prototype |
| --- | --- |
| **Weeks 1–3 — prototype the joke** | ✅ Core loop playable solo *and* in real multiplayer. |
| Weeks 4–8 — vertical slice (netcode, maps, NPC routines, skins) | 🟡 Started: working netcode, 3 maps, NPC routines, skins, taunts. Needs feel polish, content depth, art. |
| Weeks 9–10 — seed creators | ⬜ Not started (needs a Steam page + build). |
| Weeks 11–12 — launch | ⬜ Not started. |

### Honest gaps before it's a $6.99 product
- Lots of **playtesting** to confirm the joke lands with friends (the whole point of this stage).
- Game **feel** polish, real **art/audio**, more maps and events.
- **Hosted deployment** (currently LAN/tunnel), reconnect handling, anti-cheat.
- **Mobile/touch**, account/unlocks/progression, Steam integration.

This is a risk/reward map, not a finished game: capped downside (time), and the loop is proven to *work*. Next: playtest, polish the feel, then build toward the vertical slice.

---

*Built solo, with AI in the loop. Capture clips with `P` (screenshot) — see [CAPTURE.md](CAPTURE.md).*
