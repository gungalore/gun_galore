// Member-initiated bug reports. Multipart (category + description + optional
// screenshot) POSTed to POST /bugs/report. The browser sets the multipart
// boundary, so callers must NOT add a Content-Type header.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface BugReportInput {
  category: string;
  description: string;
  /** The page the member was on when they reported it. */
  url?: string;
  screenshot?: File | null;
}

export interface BugReportResult {
  received: boolean;
}

export async function submitBugReport(
  input: BugReportInput,
  token: string | null,
): Promise<BugReportResult> {
  const form = new FormData();
  form.append('category', input.category);
  form.append('description', input.description);
  if (input.url) form.append('url', input.url);
  if (input.screenshot) form.append('screenshot', input.screenshot);

  const res = await fetch(`${API_URL}/bugs/report`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const data = (await res.json().catch(() => ({}))) as {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data?.message ?? `Could not send your report (${res.status}).`);
  }
  return data as BugReportResult;
}
