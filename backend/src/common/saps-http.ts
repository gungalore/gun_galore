import * as https from 'https';
import * as tls from 'tls';
import * as zlib from 'zlib';
import { X509Certificate } from 'crypto';
import type { Readable } from 'stream';

// ────────────────────────────────────────────────────────────────────
// HOW WE TALK TO saps.gov.za, AND WHY IT NEEDS ITS OWN CLIENT.
//
// ⚠️ THE SAPS SERVER SENDS ONLY ITS OWN CERTIFICATE. The chain it should
// send is leaf → "Sectigo Public Server Authentication CA OV R36" →
// "Sectigo Public Server Authentication Root R46"; the intermediate is
// missing from the handshake. A browser fetches it by itself (AIA chasing),
// which is why the page opens on a laptop, and curl on Windows does the same
// through the OS store — but Node does not, and neither does curl on the box:
//
//   curl: (60) SSL certificate problem: unable to get local issuer certificate
//   node: UNABLE_TO_VERIFY_LEAF_SIGNATURE
//
// Both measured on the production box on 2026-09-07. The fix is not to turn
// verification off — a workbook we load into the database is exactly the
// thing a man-in-the-middle would want to swap — but to supply the public
// intermediate ourselves. It is signed by a root Node already trusts, so
// with it in the chain the leaf verifies normally (`openssl verify -untrusted
// intermediate leaf` → OK on the box).
//
// The intermediate below was fetched from the leaf's own Authority
// Information Access URL (http://crt.sectigo.com/SectigoPublicServer
// AuthenticationCAOVR36.crt) and is valid 2021-03-22 → 2036-03-21. Its
// SHA-256 fingerprint is pinned in the spec. When SAPS re-keys under a
// different CA the fetch fails loudly with the same error as before, and this
// constant is the thing to update.
//
// ⚠️ THIS FILE MOVED HERE FROM crime-stats/ ON 2026-09-25, for the SAPS
// application tracker. crime-stats/ was never the owner of "how we talk to
// saps.gov.za" — it was merely the first caller. The crime-stats fetch service
// imports it from this path now; there is no other copy.
//
// ⚠️ AND IT NOW POSTS. The application tracker's enquiry is a CSRF-protected
// form: a GET hands back a csrf_token cookie, and the answer only comes from a
// form-encoded POST that echoes it back. See sapsPostForm below.
// ────────────────────────────────────────────────────────────────────

export const SECTIGO_OV_R36_PEM = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQLBo8dulD3d3/GRsxiQrtcTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgT1YgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEApkMtJ3R06jo0fceI0M52B7K+TyMeGcv2BQ5AVc3j
lYt76TvHIu/nNe22W/RJXX9rWUD/2GE6GF5x0V4bsY7K3IeJ8E7+KzG/TGboySfD
u+F52jqQBbY62ofhYjMeiAbLI02+FqwHeM8uIrUtcX8b2RCxF358TB0NHVccAXZc
FYgZndZCeXxjuca7pJJ20LLUnXtgXcjAE1vY4WvbReW0W6mkeZyNGdmpTcFs5Y+s
yy6LtE5Zocji9J9NlNnReox2RWVyEXpA1ChZ4gqN+ZpVSIQ0HBorVFbBKyhdZyEX
gZgNSNtBRwxqwIzJePJhYd4ZUhO1vk+/uP3nwDk0p95q/j7naXNCSvESnrHPypaB
WRK066nKfPRPi9m9kIOhMdYfS8giFRTcdgL24Ycilj7ecAK9Trh0VbjwouJ4WH+x
bt47u68ZFCD/ac55I0DNHkCpaPruj6e9Rmr7K46wZDAYXuEAqB7tGG/jd6JAA+H2
O44CV98NRsU213f1kScIZntNAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQU42Z0u3BojSxdTg6mSo+bNyKcgpIw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgIw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
BZXWDHWC3cubb/e1I1kzi8lPFiK/ZUoH09ufmVOrc5ObYH/XKkWUexSPqRkwKFKr
7r8OuG+p7VNB8rifX6uopqKAgsvZtZsq7iAFw04To6vNcxeBt1Eush3cQ4b8nbQR
MQLChgEAqwhuXp9P48T4QEBSksYav7+aFjNySsLYlPzNqVM3RNwvBdvp6vgDtGwc
xlKQZVuuNVIaoYyls8swhxDeSHKpRdxRauTLZ+pl+wGvy0pnrLEJGSz9mOEmfbod
e/XopR2NGqaHJ6bIjyxPu6UtyQGI26En7UAEozACrHz06Nx2jTAY9E6NeB6XuobE
wLK025ZRmvglcURG1BrV24tGHHTgxCe8M3oGlpUSMTKQ2dkgljZVYt+gKdFtWELZ
MuRdi+X3XsrR8LFz+aLUiDRfQqhmw3RxjIyVKvvu9UPYY1nsvxYmFnUSeM+2q1z/
iPUry+xDY9MC6+IhleKT094VKdFVp7LXH42+wvU+17lRolQ2mK2N/nBLVBwaIhib
QXw4VYKwB86Bc6eS6iqsc94KEgD/U4VsjmgfhK+Xp4NM+VYzTTa3QeV3p8xOM0cw
q1p8oZFA+OBcz3FYWpDIe5j0NWKlw9hXsTyPY/HeZUV59akskSOSRSmDfe8wJDPX
58uB9/7lud0G3x0pxQAcffP0ayKavNwDTw4UfJ34cEw=
-----END CERTIFICATE-----`;

export const SAPS_INTERMEDIATE_SHA256 =
  '65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30';

/**
 * ⚠️ A BROWSER-ISH User-Agent IS NOT OPTIONAL. saps.gov.za sits behind a
 * filter that answers a bare node fetch with a block page rather than the
 * file, and a block page saved to disk is a 1 KB "xlsx" that only fails when
 * exceljs tries to unzip it.
 *
 * Moved here from crime-stats/saps-page.ts on 2026-09-25, with the rest of
 * the client — the tracker needs the same header and neither feature owns it.
 * `saps-page.ts` re-exports it so the crime-stats importer did not have to
 * move.
 */
export const SAPS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Sanity: the embedded text is a certificate and is the one we pinned. */
export function intermediateFingerprint(): string {
  return new X509Certificate(SECTIGO_OV_R36_PEM).fingerprint256;
}

export interface SapsResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

const MAX_REDIRECTS = 3;

/** Everything the request core needs. GET and POST differ only in method/body. */
interface RequestOpts {
  accept: string;
  userAgent: string;
  timeoutMs: number;
  /** Defaults to GET. */
  method?: 'GET' | 'POST';
  /** Already-encoded request body. Only meaningful with POST. */
  body?: string;
  /** Content-Type for a POST body. Ignored on a GET. */
  contentType?: string;
  /** Raw Cookie header. Sent verbatim when present. */
  cookie?: string;
}

function request(
  url: string,
  opts: RequestOpts,
  hops = 0,
): Promise<SapsResponse> {
  return new Promise((resolve, reject) => {
    const method = opts.method ?? 'GET';
    const headers: Record<string, string> = {
      'user-agent': opts.userAgent,
      accept: opts.accept,
    };
    if (opts.contentType) headers['content-type'] = opts.contentType;
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined && method === 'POST') {
      headers['content-length'] = String(Buffer.byteLength(opts.body));
    }

    const req = https.request(
      url,
      {
        method,
        headers,
        ca: [...tls.rootCertificates, SECTIGO_OV_R36_PEM],
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (hops >= MAX_REDIRECTS) {
            reject(new Error(`too many redirects fetching ${url}`));
            return;
          }
          // ⚠️ A REDIRECT ON A POST IS RE-ISSUED AS A GET, and that is correct
          // for this server: SAPS answers the enquiry POST with the results
          // directly and never redirects it. A redirect here would be a block
          // page or a login wall, and re-POSTing a CSRF form to wherever it
          // pointed is not something to do silently.
          const next = { ...opts, method: 'GET' as const, body: undefined };
          resolve(request(new URL(location, url).toString(), next, hops + 1));
          return;
        }
        resolve({ status, headers: res.headers, body: res });
      },
    );
    req.on('timeout', () => {
      req.destroy(
        new Error(`timed out after ${opts.timeoutMs} ms fetching ${url}`),
      );
    });
    req.on('error', reject);
    if (opts.body !== undefined && method === 'POST') req.write(opts.body);
    req.end();
  });
}

/**
 * GET a SAPS URL over HTTPS with the intermediate supplied, following up to
 * three redirects, with a hard timeout. The body is a Node stream so the
 * caller can cap the bytes it accepts.
 */
export function sapsGet(
  url: string,
  opts: { accept: string; userAgent: string; timeoutMs: number },
  hops = 0,
): Promise<SapsResponse> {
  return request(url, { ...opts, method: 'GET' }, hops);
}

/**
 * Form-encode a body the way an HTML form submits it: spaces become `+`, and
 * every value is percent-escaped. Pulled out of sapsPostForm so it can be
 * tested without a network call — a reference or serial with a space in it is
 * exactly the sort of value that silently arrives mangled.
 */
export function encodeForm(form: Record<string, string>): string {
  return new URLSearchParams(form).toString();
}

/**
 * POST a form-encoded body to a SAPS URL, same TLS, redirect and timeout rules.
 *
 * ⚠️ THE CALLER OWNS THE COOKIE. The enquiry needs the csrf_token the GET
 * handed back, echoed BOTH as a form field named `csrf_token` and in a Cookie
 * header — sending a field called `csrf` instead returns HTTP 400. This
 * function just carries whatever it is given; see extractCookie below.
 */
export function sapsPostForm(
  url: string,
  form: Record<string, string>,
  opts: { accept: string; userAgent: string; timeoutMs: number; cookie?: string },
  hops = 0,
): Promise<SapsResponse> {
  return request(
    url,
    {
      ...opts,
      method: 'POST',
      body: encodeForm(form),
      contentType: 'application/x-www-form-urlencoded',
      cookie: opts.cookie,
    },
    hops,
  );
}

/**
 * The value of a named cookie from a response's set-cookie headers, or null.
 *
 * ⚠️ A RESPONSE CAN SET SEVERAL COOKIES and Node types set-cookie as
 * `string | string[]`. Matching on the whole header without anchoring the name
 * finds `csrf_token` inside `x_csrf_token`; taking everything to the end
 * without stopping at `;` swallows Path/HttpOnly into the value and SAPS then
 * answers the POST with a blank result table rather than an error.
 */
export function extractCookie(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw = headers['set-cookie'];
  if (!raw) return null;
  const lines = Array.isArray(raw) ? raw : [raw];
  for (const line of lines) {
    for (const part of line.split(/,(?=\s*[^;=]+=)/)) {
      const [pair] = part.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      if (pair.slice(0, eq).trim() !== name) continue;
      const value = pair.slice(eq + 1).trim();
      if (value) return value;
    }
  }
  return null;
}

/** Read a whole (small) response body as text, decoding any content-encoding. */
export async function readText(res: SapsResponse): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of res.body) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const encoding = String(res.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  try {
    if (encoding === 'gzip' || encoding === 'x-gzip') {
      return zlib.gunzipSync(raw).toString('utf-8');
    }
    if (encoding === 'deflate') {
      return zlib.inflateSync(raw).toString('utf-8');
    }
    if (encoding === 'br') {
      return zlib.brotliDecompressSync(raw).toString('utf-8');
    }
  } catch (err) {
    // A body that claims an encoding it does not have is worse decoded wrong
    // than read raw — an HTML block page still greps, a half-decoded one does
    // not. Report it rather than silently returning mojibake.
    throw new Error(
      `could not decode ${encoding} response body: ${(err as Error).message}`,
    );
  }
  return raw.toString('utf-8');
}
