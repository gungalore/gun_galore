import * as https from 'https';
import * as tls from 'tls';
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
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': opts.userAgent, accept: opts.accept },
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
          resolve(sapsGet(new URL(location, url).toString(), opts, hops + 1));
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
    req.end();
  });
}

/** Read a whole (small) response body as text. */
export async function readText(res: SapsResponse): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of res.body) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}
