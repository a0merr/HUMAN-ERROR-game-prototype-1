# HUMAN ERROR — zero-dependency Node server.
# No npm install step: the game and server have no runtime dependencies.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server.mjs"]
