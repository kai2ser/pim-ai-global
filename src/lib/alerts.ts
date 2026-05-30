/**
 * Lightweight alerting for registry-refresh failures.
 *
 * Called by the scraper orchestrator at the end of every run. Fires a
 * notification (email and/or webhook, whatever's configured via env) when
 * any scraper reports `status='error'` or `'partial'`. Silent no-op when:
 *   - no scraper failed (the normal happy case)
 *   - the run was a dry-run (operator is debugging, doesn't want noise)
 *   - neither channel is configured (dev / staging / first-time setup)
 *
 * Fire-and-forget by design: alert send failures are logged but never
 * thrown, so they cannot abort the refresh.
 */

import { getServerEnv } from "@/lib/env";

export interface RefreshAlertContext {
  triggeredBy: "cron" | "admin";
  dryRun: boolean;
  totalFetched: number;
  totalNew: number;
  durationMs: number;
  perScraper: Array<{
    scraper: string;
    collection: string;
    status: "ok" | "partial" | "error" | "stub";
    fetched_count: number;
    new_count: number;
    duration_ms: number;
    error_message?: string;
  }>;
}

/**
 * 'partial' = at least one scraper succeeded but another hit an upstream
 * issue mid-run — operator should know.
 * 'error'   = scraper aborted, no docs ingested — operator must know.
 * 'stub'    = intentional "not implemented" state, ignore (currently no
 *             scraper returns this anymore but keep the filter explicit).
 */
function failingScrapers(ctx: RefreshAlertContext) {
  return ctx.perScraper.filter(
    (s) => s.status === "error" || s.status === "partial"
  );
}

function formatAlert(ctx: RefreshAlertContext): {
  subject: string;
  plain: string;
  html: string;
} {
  const env = getServerEnv();
  const failures = failingScrapers(ctx);
  const failureLabel = failures.map((f) => `${f.scraper} (${f.status})`).join(", ");
  const subject = `[pim-ai-global] Registry refresh: ${failureLabel}`;
  const adminUrl = `${env.APP_PUBLIC_URL}/admin`;

  const rows = ctx.perScraper.map((s) => ({
    scraper: s.scraper,
    status: s.status,
    fetched: s.fetched_count,
    new: s.new_count,
    duration: `${(s.duration_ms / 1000).toFixed(1)}s`,
    error: s.error_message ?? "",
  }));

  const plain = [
    `Registry refresh (${ctx.triggeredBy}) finished with issues.`,
    `Failures: ${failureLabel}`,
    ``,
    `Per-scraper results:`,
    ...rows.map(
      (r) =>
        `  ${r.scraper.padEnd(6)} ${r.status.padEnd(8)} fetched=${r.fetched}  new=${r.new}  ${r.duration}${
          r.error ? "  -- " + r.error : ""
        }`
    ),
    ``,
    `Total: fetched=${ctx.totalFetched}  new=${ctx.totalNew}  duration=${(ctx.durationMs / 1000).toFixed(1)}s`,
    ``,
    `Admin: ${adminUrl}`,
  ].join("\n");

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const statusColor: Record<string, string> = {
    ok: "#16a34a",
    partial: "#d97706",
    error: "#dc2626",
    stub: "#64748b",
  };

  const html = `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1d212b;">
  <h2 style="margin: 0 0 12px 0;">Registry refresh issue</h2>
  <p style="margin: 0 0 16px 0; color: #475569;">
    Trigger: <strong>${ctx.triggeredBy}</strong>. Failures: <strong>${escapeHtml(failureLabel)}</strong>.
  </p>
  <table style="border-collapse: collapse; width: 100%; max-width: 720px; font-size: 14px;">
    <thead>
      <tr style="background: #f8fafc; text-align: left;">
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Scraper</th>
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Status</th>
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">Fetched</th>
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">New</th>
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">Duration</th>
        <th style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Error</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9;">${escapeHtml(r.scraper)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: ${statusColor[r.status] ?? "#1d212b"}; font-weight: 600;">${escapeHtml(r.status)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; text-align: right;">${r.fetched}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; text-align: right;">${r.new}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; text-align: right;">${r.duration}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #b91c1c;">${escapeHtml(r.error)}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>
  <p style="margin-top: 16px; color: #475569; font-size: 14px;">
    Total: fetched=${ctx.totalFetched}, new=${ctx.totalNew}, duration=${(ctx.durationMs / 1000).toFixed(1)}s.
  </p>
  <p style="margin-top: 16px;">
    <a href="${adminUrl}" style="color: #4472c4;">Open /admin →</a>
  </p>
</body>
</html>`;

  return { subject, plain, html };
}

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  plain: string,
  html: string
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Resend lets us send from `onboarding@resend.dev` without domain
      // verification — fine for ops alerts to ourselves. Users who verify
      // their own domain can override with ALERT_FROM later if they want.
      from: "pim-ai-global alerts <onboarding@resend.dev>",
      to: [to],
      subject,
      text: plain,
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

async function sendWebhook(url: string, plain: string): Promise<void> {
  // Slack and Discord incoming webhooks both accept `{ text: "..." }`.
  // Slack also supports `blocks` for richer formatting, but plain text
  // keeps us portable — Discord rejects Slack-style blocks.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: plain }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Webhook ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/**
 * Send an alert iff the refresh had at least one failure AND wasn't a
 * dry-run AND at least one channel is configured. Otherwise no-op.
 */
export async function maybeAlertOnRefresh(ctx: RefreshAlertContext): Promise<void> {
  if (ctx.dryRun) return;
  if (failingScrapers(ctx).length === 0) return;

  const env = getServerEnv();
  const emailConfigured = Boolean(env.RESEND_API_KEY && env.ALERT_EMAIL);
  const webhookConfigured = Boolean(env.ALERT_WEBHOOK_URL);
  if (!emailConfigured && !webhookConfigured) return;

  const { subject, plain, html } = formatAlert(ctx);

  // Run both in parallel — neither blocks the other; if one fails the
  // other still has a chance to deliver. We log but never throw.
  await Promise.allSettled([
    emailConfigured
      ? sendEmail(env.RESEND_API_KEY, env.ALERT_EMAIL, subject, plain, html).catch((e) => {
          console.error("Email alert failed:", e instanceof Error ? e.message : e);
        })
      : Promise.resolve(),
    webhookConfigured
      ? sendWebhook(env.ALERT_WEBHOOK_URL, plain).catch((e) => {
          console.error("Webhook alert failed:", e instanceof Error ? e.message : e);
        })
      : Promise.resolve(),
  ]);
}
