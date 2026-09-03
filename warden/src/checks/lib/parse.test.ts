// warden/src/checks/lib/parse.test.ts
//
// Parsers, against captured shapes of the real output. The tests that
// matter most here are the NEGATIVE ones: a parser that quietly returns an
// empty result on output it does not understand is how a plausible zero
// gets onto the board without anyone writing one.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAccessLogStatuses,
  parseDf,
  parseLoadavg,
  parseMeminfo,
  parsePm2Jlist,
  parseProxyTimeouts,
  parseSslCertificatePath,
  parseUptimeSeconds,
} from './parse.js';

const DF = `Filesystem     Type   1B-blocks         Used        Avail Use% Mounted on
/dev/vda1      ext4  84140498944  42070249472  37800000000  53% /
/dev/vdb1      ext4  10000000000   9500000000    400000000  95% /var/backups
`;

test('parseDf reads every mount and keeps the mount point whole', () => {
  const { mounts, unparsed } = parseDf(DF);
  assert.equal(unparsed, 0);
  assert.equal(mounts.length, 2);
  assert.equal(mounts[0]!.target, '/');
  assert.equal(mounts[0]!.usePct, 53);
  assert.equal(mounts[1]!.availBytes, 400000000);
});

test('parseDf counts lines it cannot read instead of dropping them silently', () => {
  const { mounts, unparsed } = parseDf(`${DF}garbage line with too few fields\n`);
  assert.equal(mounts.length, 2);
  assert.equal(unparsed, 1, 'an unreadable line must be visible to the caller, not swallowed');
});

test('parseMeminfo returns null on a shape it does not recognise — never zeroes', () => {
  assert.equal(parseMeminfo('not meminfo at all'), null);
  const info = parseMeminfo('MemTotal:        8039212 kB\nMemAvailable:     512000 kB\nSwapTotal:       2097148 kB\nSwapFree:        2000000 kB\n')!;
  assert.equal(info.totalBytes, 8039212 * 1024);
  assert.equal(info.availableBytes, 512000 * 1024);
  assert.equal(info.swapUsedBytes, (2097148 - 2000000) * 1024);
});

test('parseLoadavg and parseUptimeSeconds refuse rubbish', () => {
  assert.equal(parseLoadavg('nonsense'), null);
  assert.deepEqual(parseLoadavg('0.34 0.28 0.31 1/512 21234'), { one: 0.34, five: 0.28, fifteen: 0.31 });
  assert.equal(parseUptimeSeconds('rubbish'), null);
  assert.equal(parseUptimeSeconds('912345.67 3612345.89'), 912345.67);
});

test('parseProxyTimeouts converts units and finds every occurrence', () => {
  const conf = `
    location /api/ { proxy_read_timeout 120s; proxy_connect_timeout 5s; }
    location / { proxy_read_timeout 90s; }
    location /x/ { proxy_read_timeout 2m; }
  `;
  const found = parseProxyTimeouts(conf);
  assert.deepEqual(
    found.filter((t) => t.directive === 'proxy_read_timeout').map((t) => t.seconds),
    [120, 90, 120],
  );
  assert.equal(found.find((t) => t.directive === 'proxy_connect_timeout')?.seconds, 5);
});

test('a commented-out timeout is not read as live config', () => {
  // Someone debugging leaves `# proxy_read_timeout 300s;` behind. Reading
  // it as live would report a drift that does not exist — and, worse,
  // would hide the real value sitting on the next line.
  const found = parseProxyTimeouts('# proxy_read_timeout 300s;\nproxy_read_timeout 60s;\n');
  assert.deepEqual(found.map((t) => t.seconds), [60]);
  assert.equal(found[0]!.raw, 'proxy_read_timeout 60s;');
});

test('parseSslCertificatePath takes the certificate, not the key', () => {
  const conf = '  ssl_certificate /etc/ssl/cloudflare/gungalore.pem;\n  ssl_certificate_key /etc/ssl/cloudflare/gungalore.key;\n';
  assert.equal(parseSslCertificatePath(conf), '/etc/ssl/cloudflare/gungalore.pem');
  assert.equal(parseSslCertificatePath('server { listen 443; }'), null);
});

test('parseAccessLogStatuses buckets by class and counts what it could not read', () => {
  const log = [
    '1.2.3.4 - - [03/Sep/2026:08:00:00 +0200] "GET /api/listings HTTP/1.1" 200 1234 "-" "curl/8"',
    '1.2.3.4 - - [03/Sep/2026:08:00:01 +0200] "POST /api/orders HTTP/1.1" 500 12 "-" "Mozilla"',
    '1.2.3.4 - - [03/Sep/2026:08:00:02 +0200] "GET /nope HTTP/1.1" 404 0 "-" "Mozilla"',
    'this line is not a log line at all',
  ].join('\n');
  const counts = parseAccessLogStatuses(log);
  assert.equal(counts.total, 4);
  assert.equal(counts.byClass['5xx'], 1);
  assert.equal(counts.byClass['4xx'], 1);
  assert.equal(counts.byClass['2xx'], 1);
  assert.equal(counts.unparsed, 1);
});

test('a request URI containing quotes and a fake status does not fool the status parser', () => {
  // Member-supplied paths reach this log. The status is read from the
  // position after the quoted request, not from the first 3-digit run.
  const line =
    '1.2.3.4 - - [03/Sep/2026:08:00:00 +0200] "GET /search?q=200%20500 HTTP/1.1" 404 0 "-" "Mozilla"';
  const counts = parseAccessLogStatuses(line);
  assert.equal(counts.byClass['4xx'], 1);
  assert.equal(counts.byClass['5xx'], 0);
});

test('parsePm2Jlist returns NULL on anything that is not a JSON array — never an empty list', () => {
  // 🚨 The load-bearing one. An empty array would read as "nothing is
  // running", which on this board would be a catastrophic false ok.
  assert.equal(parsePm2Jlist('pm2 could not connect to the daemon'), null);
  assert.equal(parsePm2Jlist('{"not":"an array"}'), null);
  assert.deepEqual(parsePm2Jlist('[]'), []);
});

test('parsePm2Jlist reads the fields the pm2 check judges on', () => {
  const now = Date.parse('2026-09-03T08:00:00.000Z');
  const json = JSON.stringify([
    {
      name: 'alloutdoor-backend',
      pid: 4242,
      pm2_env: { status: 'online', unstable_restarts: 3, restart_time: 41, pm_uptime: now - 3_600_000, pm_cwd: '/home/alloutdoor/app/backend' },
      monit: { memory: 700 * 1024 * 1024, cpu: 4 },
    },
  ]);
  const [proc] = parsePm2Jlist(json, now)!;
  assert.equal(proc!.name, 'alloutdoor-backend');
  assert.equal(proc!.status, 'online');
  assert.equal(proc!.unstableRestarts, 3);
  assert.equal(proc!.restarts, 41);
  assert.equal(proc!.uptimeMs, 3_600_000);
});

test('a pm2 entry missing its counters reports null, not zero', () => {
  const [proc] = parsePm2Jlist('[{"name":"x","pm2_env":{"status":"online"},"monit":{}}]')!;
  assert.equal(proc!.unstableRestarts, null, 'a missing counter must not read as "no unstable restarts"');
  assert.equal(proc!.memoryBytes, null);
});
