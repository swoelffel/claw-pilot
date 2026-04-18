# Authentication and Security

ClawPilot uses session-based authentication for the Dashboard and token-based authentication for API and WebSocket access. All mutation routes are validated with Zod schemas.

## Dashboard Login

The primary authentication method for browser-based access:

1. User submits credentials to `POST /api/auth/login`
2. Server validates password against scrypt hash stored in the users table
3. On success, an **HttpOnly session cookie** is set with a configurable TTL
4. Subsequent requests include the cookie automatically

The session cookie is HttpOnly and Secure (when HTTPS is enabled), preventing JavaScript access and mitigating XSS attacks.

## Bearer Token Authentication

For programmatic API access and SSE connections, bearer token auth is available as a fallback:

| Method | Format | Use Case |
|--------|--------|----------|
| Authorization header | `Authorization: Bearer <token>` | REST API calls, scripts |
| Query parameter | `?token=<token>` | SSE event streams (EventSource does not support headers) |

The dashboard token is a 64-character hex string stored at `~/.claw-pilot/dashboard-token`. It is generated during `claw-pilot init` and can be regenerated with `claw-pilot token --rotate`.

## WebSocket Authentication

WebSocket connections authenticate via the first message:

1. Client opens WebSocket connection to `/ws`
2. Client sends `{"type": "auth", "token": "<dashboard-token>"}`
3. Server validates the token and upgrades the connection
4. If invalid, the connection is closed with code 4001

No further authentication is needed after the initial handshake.

## User Roles

| Role | Permissions |
|------|-------------|
| **admin** | Full access: manage users, instances, blueprints, flows, API keys, system settings |
| **operator** | Manage instances and flows. Cannot create users or modify system settings |
| **viewer** | Read-only access to dashboard, logs, and monitoring screens |

Roles are stored in the `users` table in registry.db. The first user created during `claw-pilot init` is always assigned the admin role.

## Password Hashing

Passwords are hashed using **scrypt** with the following parameters:

- Key length: 64 bytes
- Salt: 32 random bytes per user
- Cost parameter (N): 16384
- Block size (r): 8
- Parallelization (p): 1

Plaintext passwords are never stored or logged.

## Rate Limiting

| Endpoint Pattern | Limit |
|-----------------|-------|
| `GET /api/*` | 60 requests per minute per IP |
| `POST /api/*` | 60 requests per minute per IP |
| `POST /api/instances` | 30 requests per minute per IP |
| `POST /api/auth/login` | 10 requests per minute per IP (brute-force protection) |

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in all API responses.

## Security Headers

All HTTP responses include hardened security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | Script/style sources restricted to self | Prevent XSS and code injection |
| `X-Frame-Options` | `DENY` | Block clickjacking via iframe embedding |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing attacks |
| `Strict-Transport-Security` | `max-age=31536000` (when HTTPS) | Enforce HTTPS connections |
| `X-XSS-Protection` | `0` | Disabled in favor of CSP (legacy header) |

## Request Validation

All mutation routes (POST, PUT, PATCH, DELETE) validate request bodies using **Zod schemas**. Invalid payloads return HTTP 400 with structured error details:

```json
{
  "error": "VALIDATION_ERROR",
  "details": [
    { "path": ["config", "model"], "message": "Required" }
  ]
}
```

GET endpoints validate query parameters where applicable.

## Initial Setup

During `claw-pilot init`, the setup wizard:

1. Creates the first admin user (username + password)
2. Generates the dashboard token at `~/.claw-pilot/dashboard-token`
3. Initializes the `users` table in registry.db
4. Configures the HTTP port and optional HTTPS settings

## Session Management

- Sessions are stored server-side with a configurable TTL (default: 24 hours)
- Expired sessions are cleaned up automatically
- `POST /api/auth/logout` invalidates the current session immediately
- Closing the browser does not invalidate the session (cookie persists until TTL)

*ClawPilot v0.74.1*
