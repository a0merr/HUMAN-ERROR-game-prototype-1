# HUMAN ERROR — hosting

Get a public, shareable URL (no LAN, no tunnel). The server is **zero-dependency
Node** — there's nothing to build, so deploys are fast and cheap.

## What the server needs from a host

- **Node 18+**, start command `node server.mjs`.
- **One port** from the `PORT` env var (the server already reads it; defaults to
  8080). HTTP and the WebSocket share that one port.
- **WebSocket support** through the platform's proxy (all the options below have it).
- **A single instance.** Rooms are in-memory, so every player in a match must hit
  the same process — keep it at **1 instance** (don't scale horizontally yet; see
  "Scaling" below).
- Health check path: **`/healthz`** (returns `200 ok`).

## One-command-ish deploys

Config files are included for the common free/cheap hosts — pick one:

### Render (`render.yaml`)
1. Push this repo to GitHub.
2. Render → New → Blueprint → pick the repo. It reads `render.yaml`.
3. Done. Render gives you `https://human-error.onrender.com`.
   (Free tier sleeps when idle and cold-starts on the next visit.)

### Fly.io (`fly.toml` + `Dockerfile`)
```bash
fly launch --copy-config --now     # first time (creates the app)
fly deploy                         # subsequent deploys
```
Keep it to one machine: `fly scale count 1`.

### Railway (`Procfile`)
- New Project → Deploy from GitHub repo. Railway auto-detects Node + the `Procfile`.
- It injects `PORT` automatically. WebSockets work over its domain.

### Any Docker host (`Dockerfile`)
```bash
docker build -t human-error .
docker run -p 8080:8080 human-error
# open http://localhost:8080
```

## After deploy

- Solo: `https://YOUR-URL/solo`
- Multiplayer: `https://YOUR-URL/`
- The client auto-uses `wss://` on HTTPS, so secure WebSockets just work.

## Scaling (later)

Single process handles many small rooms fine. To go bigger, the in-memory room
map (`server.mjs`) needs to move to a shared store (e.g. Redis) and rooms need to
be sticky to an instance, or run one room-server per region behind a matchmaker.
Not needed for playtests or launch-day virality on a single beefy instance.
