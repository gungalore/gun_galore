// Parse a fetch Response as JSON while tolerating an EMPTY body.
//
// A raw `res.json()` throws "Failed to execute 'json' on 'Response':
// Unexpected end of JSON input" whenever the server answers with NO body
// — which is the norm for PATCH/DELETE mutations (empty 200/204) and for
// zero-data GETs (e.g. /subscriptions/me for a brand-new user). This
// reads the text first and returns `fallback` when the body is empty or
// unparseable, so a legitimate empty response never crashes the page.
//
// (The account/dashboard/profile server components already inline this
// same guard; this is the shared client-safe version for 'use client'
// pages — settings, profile edit, etc.)
export async function safeJson<T = unknown>(
  res: Response,
  fallback: T,
): Promise<T> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}
