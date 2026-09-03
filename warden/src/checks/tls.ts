// warden/src/checks/tls.ts
//
// TWO certificates, and they fail in different ways:
//
//   tls-edge   — what a browser actually receives. Cloudflare renews it,
//                so this check is not a renewal reminder; it exists to
//                catch that renewal going wrong, and to record the chain
//                AS SERVED (intermediates included) rather than as
//                configured.
//   tls-origin — the Cloudflare Origin CA certificate on disk, the
//                nginx↔Cloudflare leg. It is a 15-year cert, so expiry is
//                rarely the story. The story is the FILE: nginx has it
//                loaded in memory, so if it has gone missing or unreadable
//                the site keeps working right up until the next reload,
//                and then does not. That is exactly the failure that looks
//                fine until someone touches it.
//
// ⚠️ Neither hostname nor cert path is hardcoded: the host comes from
// config (WARDEN_PUBLIC_HOST) and the path is read out of the LIVE nginx
// config, because the repo's copy still says gungalore.

import { X509Certificate } from 'node:crypto';
import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, ev, ok, unknown, warn } from './result.js';
import { readLiveNginxConfig } from './lib/nginx-conf.js';
import { parseSslCertificatePath } from './lib/parse.js';

const EDGE_WARN_DAYS = 14;
const ORIGIN_WARN_DAYS = 60;

export const tlsEdgeCheck: CheckModule = {
  id: 'tls-edge',
  title: 'TLS certificate as served',
  cost: 'moderate',
  cadenceMs: 60 * 60_000,
  timeoutMs: 15_000,
  async run(ctx): Promise<CheckOutcome> {
    const host = ctx.config.publicHost;
    const result = await ctx.tlsChain(host, 443, { timeoutMs: 8_000 });
    if (!result.ok) return unknown(result.error, [ev('host', `${host}:443`)]);

    const leaf = result.value.chain[0]!;
    const expires = new Date(leaf.validTo);
    if (Number.isNaN(expires.getTime())) {
      return unknown(`the certificate served by ${host} has an unreadable notAfter (${leaf.validTo})`);
    }
    const days = Math.floor((expires.getTime() - ctx.now().getTime()) / 86_400_000);

    const evidence: Evidence[] = [
      ev('subject', leaf.subject, `TLS handshake with ${host}:443`),
      ev('issuer', leaf.issuer),
      ev('expires', `${leaf.validTo} (${days} days)`),
      ev('chain as served', result.value.chain.map((c) => c.subject).join('  ←  ')),
      ev('protocol', result.value.protocol ?? 'unknown'),
      ev(
        'node verdict',
        result.value.authorized ? 'chain verifies against the system trust store' : `NOT verified — ${result.value.authorizationError}`,
      ),
    ];

    if (days < 0) return bad(`The certificate ${host} serves expired ${Math.abs(days)} days ago.`, evidence);
    if (!result.value.authorized) {
      return bad(`${host} serves a chain that does not verify: ${result.value.authorizationError}.`, evidence);
    }
    if (days <= EDGE_WARN_DAYS) {
      return warn(`The certificate ${host} serves expires in ${days} days and has not renewed yet.`, evidence);
    }
    return ok(`${host} serves a valid certificate, ${days} days left, issued by ${shortIssuer(leaf.issuer)}.`, evidence);
  },
};

export const tlsOriginCheck: CheckModule = {
  id: 'tls-origin',
  title: 'Origin certificate on disk',
  cost: 'moderate',
  cadenceMs: 6 * 60 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const conf = await readLiveNginxConfig(ctx);
    if (!conf.ok) return unknown(`cannot read the live nginx config, so the origin cert path is unknown — ${conf.error}`);
    const certPath = parseSslCertificatePath(conf.value.text);
    if (!certPath) {
      return unknown(`no ssl_certificate directive found in the live config (${conf.value.source})`);
    }
    // The path comes out of a config file, so it is a measured fact. It is
    // only ever used as an fs read (never argv, never a shell), but a
    // shape check keeps a mangled parse from producing a nonsense reason.
    if (!/^\/[^\s;]+$/.test(certPath)) {
      return unknown(`the ssl_certificate directive does not look like an absolute path: ${certPath}`);
    }

    const read = await ctx.readFile(certPath);
    if (!read.ok) {
      // nginx still has it loaded — the site is up. The NEXT reload is
      // what breaks, which is why this is bad rather than unknown.
      return bad(
        `nginx is serving from ${certPath} but Warden cannot read it — the next reload or nginx -t will fail. ${read.error}.`,
        [ev('path', certPath, conf.value.source)],
      );
    }

    let cert: X509Certificate;
    try {
      cert = new X509Certificate(read.value);
    } catch (err) {
      return bad(`${certPath} is not a parseable certificate — the next nginx reload will fail. ${String(err)}.`, [
        ev('path', certPath, conf.value.source),
      ]);
    }

    const expires = new Date(cert.validTo);
    const days = Math.floor((expires.getTime() - ctx.now().getTime()) / 86_400_000);
    const evidence: Evidence[] = [
      ev('path', certPath, conf.value.source),
      ev('subject', cert.subject.replace(/\n/g, ', ')),
      ev('issuer', cert.issuer.replace(/\n/g, ', ')),
      ev('expires', `${cert.validTo} (${days} days)`),
    ];
    if (days < 0) return bad(`The origin certificate at ${certPath} expired ${Math.abs(days)} days ago.`, evidence);
    if (days <= ORIGIN_WARN_DAYS) return warn(`The origin certificate expires in ${days} days.`, evidence);
    return ok(`Origin certificate present and readable, ${days} days left.`, evidence);
  },
};

export const tlsChecks: CheckModule[] = [tlsEdgeCheck, tlsOriginCheck];

function shortIssuer(issuer: string): string {
  const cn = issuer.match(/(?:^|,\s*)(?:CN|O)=([^,]+)/);
  return cn ? cn[1]!.trim() : issuer;
}
