import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "./config.js";
import { ensureUserSettings } from "./provision.js";
import { log } from "./logger.js";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
}

const PROJECT_URL = config.supabaseProjectUrl.replace(/\/+$/, "");

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let issuer = "";

function ensureJwks() {
  if (!PROJECT_URL) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${PROJECT_URL}/auth/v1/.well-known/jwks.json`));
    issuer = `${PROJECT_URL}/auth/v1`;
  }
  return jwks;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function extractUser(payload: JWTPayload): AuthUser | null {
  const id = payload.sub;
  if (!id) return null;
  return {
    id,
    email: typeof payload.email === "string" ? payload.email : "",
  };
}

/**
 * Express middleware that verifies the Supabase access token (JWT) on each
 * request. Uses the project's public JWKS endpoint so no secret is stored
 * server-side. Attaches the verified user to req.user.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing Authorization: Bearer token" });
    return;
  }

  const keyset = ensureJwks();
  if (!keyset) {
    res.status(503).json({
      error: "Auth is not configured. Set SUPABASE_PROJECT_URL on the API server.",
    });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, keyset, {
      issuer,
      audience: "authenticated",
    });
    const user = extractUser(payload);
    if (!user) {
      res.status(401).json({ error: "Invalid token: missing subject" });
      return;
    }
    (req as AuthedRequest).user = user;
    ensureUserSettings(user.id).catch((e) =>
      log.error("[auth]", `ensureUserSettings failed for ${user.id}: ${e.message}`),
    );
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}