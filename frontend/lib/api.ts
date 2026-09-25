const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function apiBaseUrl(): string {
  // A relative `/api` base works in the browser through the Next rewrite, but
  // server components need an absolute backend URL for server-to-server fetches.
  if (typeof window === 'undefined' && API_URL.startsWith('/')) {
    return process.env.INTERNAL_API_URL ?? 'http://localhost:3001/api';
  }

  return API_URL;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
