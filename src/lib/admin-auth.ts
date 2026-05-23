/**
 * Bearer-token gate for admin + cron routes.
 *
 * Used by:
 *   - /api/admin/* (caller is the operator's browser via /admin page)
 *   - /api/cron/* (caller is Vercel Cron, which sends
 *     `Authorization: Bearer $CRON_SECRET` automatically)
 *
 * Constant-time compare to defend against length-prefix timing leaks.
 * Returns 403 if the configured secret is empty (safer fallback than
 * 200-open during initial deployment).
 */
import type { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractBearer(req: NextRequest): string {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

/** True if the request carries the admin token (or the cron secret on cron paths). */
export function isAdmin(req: NextRequest): boolean {
  const env = getServerEnv();
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  return constantTimeEqual(extractBearer(req), expected);
}

/**
 * Vercel Cron sends a Bearer header keyed to CRON_SECRET. We accept either
 * CRON_SECRET (Vercel's auto-set value) or ADMIN_TOKEN (so the operator can
 * also trigger cron-style refreshes manually with the admin token).
 */
export function isCronOrAdmin(req: NextRequest): boolean {
  const env = getServerEnv();
  const cron = env.CRON_SECRET;
  const admin = env.ADMIN_TOKEN;
  const presented = extractBearer(req);
  if (!presented) return false;
  if (cron && constantTimeEqual(presented, cron)) return true;
  if (admin && constantTimeEqual(presented, admin)) return true;
  return false;
}
