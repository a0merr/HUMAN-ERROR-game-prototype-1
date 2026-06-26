# HUMAN ERROR — Store / launch kit

Ready-to-paste copy for the Steam page, the free demo pitch, and creator outreach.
Built around the **recommended model: paid $6.99 + a free, generous demo** (the solo
roguelite carries the price; the demo + never-empty online carry the funnel). The
F2P alternative is noted at the bottom — pick before publishing, everything else flows from it.

---

## 1. Identity

- **Name:** HUMAN ERROR
- **Tagline (capsule):** *One of them is real.*
- **One-liner:** A reverse-Turing-test hide-in-the-crowd game — blend into a crowd of identical AI, because humans always out themselves by being *too human*.
- **Price:** $6.99 (USD). Launch discount 10–15% for the first week.
- **Visual identity:** surveillance-noir. The whole game is rendered as a phosphor-green security feed — REC dot, CAM-ID, timecode, scanlines, chroma-glitch on a catch — baked into the canvas so every auto-clip is on-brand "leaked footage."

## 2. Short description (≤300 chars — Steam "Short Description")

> You're the only human hidden in a crowd of identical AI. Act fake. Blend in. Don't twitch, don't sprint, don't panic — the Hunter scans for the one body acting *too human*. A reverse-Turing-test party game that auto-clips your funniest busts as security footage.

## 3. About This Game (full description)

**One of them is real. It's you.**

HUMAN ERROR drops you into a crowd of identical AI NPCs running their little loops — idling, wandering, dancing. You wear the same skin. Your only job: **act fake enough to blend in.** Because a Hunter is watching the feed, scanning for the one body that moves like a person — the one that sprints when it's scared, flinches when it's spotted, bunches up, over-dances, hesitates. The joke that runs the whole game: **humans always out themselves by being too human.**

**🎯 Solo — the Behavioral Scan (a full single-player roguelite)**
Survive escalating waves against 1→4 AI Hunters. Bank a style combo (up to ×3) for busting the dumb-human bots around you. Grab one of **15 stacking perks** each wave — Ghost Step, Decoy Drop, Blink, Magnet Decoy, Adrenaline, Low Profile. Climb the lifetime ranks from **ROOKIE BLENDER** to **GHOST IN THE CROWD**. A complete game that's fun with nobody else online.

**👥 Online — never an empty lobby**
Quick-play or private rooms. One human becomes the Hunter; everyone else hides. Short a player? A **server-driven AI Hunter** takes the seat, and dumb-human bots fill the crowd — so a room with *one* human is still a full, tense match. Drop in mid-game, reconnect after a disconnect, taunt with emotes.

**🎬 It clips itself**
Every bust auto-saves a short, shareable clip — stamped with the REC dot, timecode and a chroma-glitch — so your funniest "too human" moments are ready to post without you lifting a finger. One key grabs the last few seconds anytime.

**🧪 30 seconds to "I get it"**
A skippable training round teaches the whole joke fast: you're the human → blend-walk → spot the tell → evade the Hunter → drop in.

**Features**
- Reverse-Turing-test stealth: win by being *unremarkable*, not fast
- Solo wave roguelite with 15 perks, combos, and lifetime meta-progression
- Online with AI bot-fill — never a dead lobby, drop-in/out, reconnect
- Auto-clip pipeline that brands every highlight as security footage
- 6 maps, 7 crowd-glitch events (Fire Alarm, Stampede, Take a Bow…), 7 skins, 5 body types
- A signature surveillance-cam look and a diegetic soundscape (room-tone hum, sonar lock, shutter)
- Zero-dependency engine; one shared deterministic sim drives solo and online identically

## 4. Steam tags (priority order)

`Social Deduction` · `Party Game` · `Stealth` · `Multiplayer` · `Singleplayer` ·
`Funny` · `Roguelite` · `Local Co-Op?(no)` · `Online Co-Op` · `Indie` ·
`Top-Down` · `Casual` · `Replay Value` · `Memes`

## 5. The free demo (top-of-funnel)

Ship a **browser demo** (the engine already runs in-browser) AND a Steam demo:
- **Free:** solo training + waves 1–5, all tells/clips, one map rotation.
- **Gated to full game:** endless waves, all 15 perks/6 maps, online multiplayer.
- Demo end screen → **“WISHLIST ON STEAM”** CTA. The browser build is a single shareable link — perfect for streamers and Discord.

## 6. Creator / streamer one-pager (paste into outreach DMs)

> **HUMAN ERROR** — a reverse-Turing-test party game. You hide in a crowd of identical AI; one player Hunts for whoever's acting *too human*. It reads in 10 seconds on stream and it auto-records your funniest busts as glitchy "security footage" clips — zero editing.
> • Playable instantly in the browser (link below) — no install for you or chat
> • Never a dead lobby (AI fills empty seats), so it works at any audience size
> • Free key + private build attached. Clip it, keep it, no embargo.
> [browser link] · [Steam page] · [press kit]

## 7. Deploy (so a stranger can click & play)

Server is already `/healthz` + SIGTERM + `PORT`-env ready. Pick one:

```bash
# Render (render.yaml present) — push repo, "New Web Service", auto-detects. Or Fly:
fly launch --copy-config --now        # fly.toml present
fly deploy

# Railway:  railway up      (Procfile present: web: node server.mjs)
```

After it's live, set the browser-demo link to the hosted URL and put it on the Steam page + every creator DM.

---

### If you go F2P instead
Swap §1 price to **Free-to-Play**; move "endless + all perks + extra maps" into a one-time **$3.99 Premium** unlock (mirror Just Act Natural's model). Keep everything else. F2P maximizes the crowd (the product *is* the player base) but monetizes thinner — choose based on whether the online social loop or the solo game is the real draw.
