// src/dashboard/routes/auth.ts
import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { authenticate } from "../../core/auth/index.js";
import { constants } from "../../lib/constants.js";
import { apiError } from "../route-deps.js";
import type { RouteDeps } from "../route-deps.js";
import { createRateLimiter } from "../rate-limit.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";

/** Timing-safe Bearer token comparison */
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: Hono, deps: RouteDeps, token: string): void {
  const { registry, sessionStore } = deps;
  const expectedBearer = `Bearer ${token}`;

  // Strict rate limiter for login attempts (brute-force protection)
  const loginRateLimiter = createRateLimiter({
    maxRequests: constants.AUTH_RATE_LIMIT_MAX,
    windowMs: constants.AUTH_RATE_LIMIT_WINDOW_MS,
  });

  // POST /api/auth/login — authenticate and create a session
  // no permission() — public endpoint, auth runs INSIDE the handler
  app.post("/api/auth/login", loginRateLimiter, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, 400, "INVALID_BODY", parsed.error.message);
    }
    const { username, password } = parsed.data;

    // Delegate to the registered AuthProvider for "password". The provider
    // encapsulates the user lookup and credential verification; routing
    // stays agnostic so Enterprise SSO can plug in additional kinds without
    // touching this handler.
    const result = await authenticate("password", { username, password });

    if (!result.ok) {
      registry.logEvent(null, "auth_login_failed", `username=${username}`);
      return apiError(c, 401, "INVALID_CREDENTIALS", "Invalid credentials");
    }

    const user = result.user;

    // Create session
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";
    const ua = c.req.header("user-agent") ?? null;
    const sessionId = sessionStore.create(user.id, ip, ua ?? undefined);

    // Set HttpOnly cookie — Secure only when behind HTTPS proxy
    const isHttps = c.req.header("x-forwarded-proto") === "https";
    setCookie(c, constants.SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "Strict",
      path: "/",
      maxAge: Math.floor(constants.SESSION_TTL_MS / 1000),
    });

    registry.logEvent(null, "auth_login_success", `username=${username}`);

    return c.json({ ok: true, token });
  });

  // POST /api/auth/logout — invalidate session and clear cookie
  app.post(
    "/api/auth/logout",
    permission({ action: ACTIONS.AUTH_LOGOUT, resource: { kind: "auth" } }),
    (c) => {
      const sid = getCookie(c, constants.SESSION_COOKIE_NAME);
      if (sid) {
        sessionStore.delete(sid);
      }
      deleteCookie(c, constants.SESSION_COOKIE_NAME, { path: "/" });
      return c.json({ ok: true });
    },
  );

  // GET /api/auth/me — return current session info + token for WS
  app.get(
    "/api/auth/me",
    permission({ action: ACTIONS.AUTH_ME, resource: { kind: "auth" } }),
    (c) => {
      // 1. Try session cookie
      const sid = getCookie(c, constants.SESSION_COOKIE_NAME);
      if (sid) {
        const session = sessionStore.validate(sid);
        if (session) {
          const db = registry.getDb();
          const user = db
            .prepare("SELECT username, role FROM users WHERE id = ?")
            .get(session.userId) as { username: string; role: string } | undefined;
          if (user) {
            return c.json({
              authenticated: true,
              username: user.username,
              role: user.role,
              token,
            });
          }
        }
      }

      // 2. Fallback: Bearer token (programmatic access)
      const auth = c.req.header("authorization") ?? "";
      if (safeTokenCompare(auth, expectedBearer)) {
        return c.json({
          authenticated: true,
          username: constants.ADMIN_USERNAME,
          role: "admin",
          token,
        });
      }

      return apiError(c, 401, "UNAUTHORIZED", "Unauthorized");
    },
  );
}
