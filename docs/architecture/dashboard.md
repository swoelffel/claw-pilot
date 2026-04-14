# Web Dashboard

> Part of [claw-pilot Functional Architecture](README.md)

---

Hono HTTP/WS server on port 19000. Dual auth: session cookie (priority) or Bearer token (fallback).

## Security

| Mechanism | Detail |
|---|---|
| **Session auth** | `POST /api/auth/login` → HttpOnly cookie, server session store with TTL |
| **Token auth** | `Authorization: Bearer <token>` — timing-safe comparison |
| **WebSocket auth** | First message authenticated via token |
| **SSE auth** | Bearer token via `?token=` query string (EventSource cannot set headers) + `withCredentials: true` for cookies |
| **Rate limiting** | 60 req/min per IP on `/api/*` · 30 req/min on `POST /api/instances` · 1/5min self-update |
| **Security headers** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` |
| **Validation** | Zod schemas on all mutation routes (config patches, tasks, budgets, blueprints, flows) |
| **TokenCache** | In-memory token cache |
| **Public healthcheck** | `GET /health` without auth |

## Token architecture

| Token | Size | Storage | Role |
|---|---|---|---|
| **Dashboard token** | 64 chars hex | `~/.claw-pilot/dashboard-token` | Authenticates dashboard REST API (Bearer) |
| **Session cookie** | UUID | Server-side session store | Dashboard auth (HttpOnly cookie) |
| **Password hash** | scrypt | `users` table | Login auth |

## WebSocket Monitor

WS connection on `/ws`. Auth via first applicative message (timing-safe token compare). Broadcasts `health_update` every 10s with each instance state (delta-compressed). Enriches with: pending permissions, heartbeat agents/alerts, MCP count.

For real-time streaming (chat, events), see [SSE Architecture](../sse-architecture.md).

## Platform compatibility

| Manager | Platform | claw-runtime instances |
|---|---|---|
| **systemd --user** | Linux | PID file |
| **launchd** | macOS | PID file |
| **Docker** | Container | PID file |

## Internationalization

6 languages: English, French, German, Spanish, Italian, Portuguese. Via `@lit/localize` (runtime, dynamic loading). See [i18n.md](../i18n.md).

---

*Updated: 2026-04-14 — v0.72.6*
