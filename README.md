# HUMAN ERROR — playable prototype

> *One of them is real.*

A multiplayer **hide-in-the-crowd** party game. A map is packed with identical AI NPCs running looping routines. A few humans are dropped in wearing the same skin; one is the **Hunter**. Hiders survive by *acting fake* — mimicking the NPCs. Humans always out themselves by being too human: sprinting, panicking, fumbling a glitch event, doing a too-perfect dance. A reverse Turing test as a party game — instantly legible, inherently funny, meme-ready.

This repo is a working, end-to-end **prototype** built to prove the joke (the deck's weeks 1–3 gate: *"if it isn't funny with friends, kill it cheap"*).

---

## What's built

**Solo mode** — `index.html` + `game.js` (double-click, runs offline)
- Endless **wave roguelite**: survive 40s, clear a wave, pick a stacking **perk**, face harder waves.
- **Multiple AI Hunters** (1 → 4) that scan a line-of-sight cone, lock on, and creep in to inspect — purely on *behavior*, never identity.
- **Blend mechanic**: match the crowd's pose/speed, hold Shift to walk at NPC speed, hide behind cover. Sprint or stand out → suspicion spikes.
- **Glitch events** (fire alarm / cash drop / freeze), **dumb-human bots** that visibly slip, **kill-cam** on capture, **score + best run** saved locally.

**Multiplayer** — `server.js` + `mp.html` + `mp.js` (run the server)
- **Zero-dependency** Node server (hand-rolled WebSocket, no npm install) with a **server-authoritative** 20Hz crowd sim.
- **Quick Play** matchmaking + **private rooms** with server-minted unique codes (no collisions at scale; capacity-capped).
- One random human is the **Hunter**; the rest blend. NPC crowd + slipping bots fill the scene. Hunter presses **Space** to tag the body in front: catch a human/bot, or whiff an NPC and get **stunned**.
- **3 maps** (Plaza / Atrium / Stacks) + **5 crowd skins** + **taunt emotes** (1–4) for clip variety and meme surface.
- Catch **kill-cam**, screen flash, **"HUMANS LEFT: N"** stakes, killfeed, audio + juice.
- Playable over **LAN** out of the box; **internet** via one tunnel command.

---

## Run it

See **[RUN.md](RUN.md)** for full instructions.

```bash
# Solo: just open index.html

# Multiplayer:
npm start              # prints localhost + LAN URLs
# friends on your wifi open the printed http://192.168.x.x:8080
# for internet friends, in a second terminal:
npm run tunnel         # public link, no account
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
