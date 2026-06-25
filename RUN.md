# HUMAN ERROR — how to run

A hide-in-the-crowd party game prototype. Two ways to play:

- **Solo (offline):** just open `index.html` in a browser. Wave roguelite vs AI Hunters.
- **Multiplayer:** run the server (below), then play with friends.

No build step. No npm install required for the game itself — the server is zero-dependency Node.

---

## 1. Solo (no server)

Double-click **`index.html`**, or open it in Chrome/Edge. That's it.

---

## 2. Multiplayer — same machine / same wifi

Requires **Node.js 18+** ([nodejs.org](https://nodejs.org)).

```bash
npm start          # or:  node server.js
```

The server prints the URLs to use, e.g.:

```
This machine:   http://localhost:8080
Same-wifi friends, share one of these:
                http://192.168.1.24:8080
```

- **You:** open `http://localhost:8080`.
- **Friends on the same wifi:** open the `192.168.x.x` link the server printed.
- One person clicks **Create Room**, shares the 4-letter code; everyone else **Joins** with it (or use **Quick Play**). One player presses **Start**.

> Windows may pop a firewall prompt the first time — allow Node on private networks so LAN friends can connect.

---

## 3. Multiplayer — friends over the internet

Keep `npm start` running, then in a **second terminal**:

```bash
npm run tunnel
```

This runs `localtunnel` (via `npx`, no install/account) and prints a public `https://…loca.lt` link. Share that link with anyone, anywhere. It tunnels both the page and the realtime WebSocket.

> localtunnel may show a one-time interstitial asking for a password — it's the **public IP of the machine running the server** (it tells you where to find it). Other tunnel options if you prefer:
> - **ngrok:** `ngrok http 8080` (needs a free account + authtoken)
> - **cloudflared:** `cloudflared tunnel --url http://localhost:8080` (needs the cloudflared binary)

---

## Controls

| Action | Key |
| --- | --- |
| Move | WASD / Arrows |
| Slow "NPC" walk | Hold Shift |
| Dance | Hold F |
| Taunt | 1 – 4 |
| Hunter: tag | Space |
| Solo: drop decoy (perk) | Q |

## How a multiplayer match works

- One random human is the **Hunter**; everyone else is a **hider** blending into a crowd of identical AI NPCs (+ dumb-human bots that slip).
- The Hunter walks up and presses **Space** to tag the body in front. Tag a human/bot = caught. Tag a plain NPC = **stunned**.
- Hiders win if anyone survives the timer. Hunter wins by catching every human hider.

---

## Notes / current limits (prototype)

- Single Node process, in-memory rooms (plenty for testing; scale later with multiple instances + shared store).
- No reconnect yet — refresh rejoins as a new player.
- localhost/LAN/tunnel only; no hosted deployment yet.
