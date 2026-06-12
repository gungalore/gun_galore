/**
 * One-shot: register the post-payment redirect URL on the Stitch Express
 * account and confirm it's listed. Reads creds from the backend .env.
 * Prints ONLY status codes + the registered URL list — never secrets.
 *
 * Run on prod from the backend dir so require('dotenv') + global fetch
 * resolve:  cd /home/gungalore/app/backend && node /tmp/stitch-redirect-setup.cjs
 */
require('dotenv').config({ path: process.env.ENV_PATH || '.env' });

const BASE = (process.env.STITCH_API_URL || 'https://express.stitch.money').replace(/\/$/, '');
const ID = process.env.STITCH_CLIENT_ID;
const SECRET = process.env.STITCH_CLIENT_SECRET;
const FRONTEND = (process.env.FRONTEND_URL || 'https://gungalore.co.za').replace(/\/$/, '');
const REDIRECT = `${FRONTEND}/checkout/complete`;

async function getToken(scope) {
  const r = await fetch(`${BASE}/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: ID, clientSecret: SECRET, scope }),
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, token: j && j.data && j.data.accessToken };
}

async function register(tok) {
  const r = await fetch(`${BASE}/api/v1/redirect-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ redirectUrl: REDIRECT }),
  });
  let body = '';
  try { body = await r.text(); } catch {}
  return { status: r.status, body: body.slice(0, 400) };
}

async function list(tok) {
  const r = await fetch(`${BASE}/api/v1/redirect-urls`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  let body = '';
  try { body = await r.text(); } catch {}
  return { status: r.status, body: body.slice(0, 800) };
}

(async () => {
  if (typeof fetch !== 'function') {
    console.error('No global fetch — need Node 18+');
    process.exit(1);
  }
  console.log('BASE         :', BASE);
  console.log('FRONTEND_URL :', FRONTEND);
  console.log('REDIRECT     :', REDIRECT);
  console.log('configured   :', !!ID, !!SECRET);
  if (!ID || !SECRET) { console.error('Missing STITCH_CLIENT_ID/SECRET'); process.exit(1); }

  const t = await getToken('client_paymentrequest');
  console.log('token(client_paymentrequest):', t.status, t.token ? `OK len=${t.token.length}` : 'NO TOKEN');
  if (!t.token) process.exit(1);

  console.log('register:', JSON.stringify(await register(t.token)));
  console.log('list    :', JSON.stringify(await list(t.token)));
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
