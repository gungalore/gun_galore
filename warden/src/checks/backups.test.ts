// warden/src/checks/backups.test.ts
//
// The CIP gap is the standing bad this daemon was partly built to say out
// loud, so it gets its own tests: it must be bad, it must be STANDING (a
// red gate upstream — no command, not approvable), it must carry the live
// exposure as evidence, and it must clear ONLY when backup.sh itself
// changes — never because a directory happened to be empty that day.

import test from 'node:test';
import assert from 'node:assert/strict';
import { backupSetGapCheck } from './backups.js';
import { runOne } from './engine.js';
import { fakeContext } from './testing.js';

const SCRIPT_WITHOUT_CIP = [
  '#!/usr/bin/env bash',
  'pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_DIR/db/$STAMP.dump"',
  'tar -czf "$BACKUP_DIR/uploads/$STAMP.tar.gz" -C "$SECURE_UPLOAD_DIR" .',
].join('\n');

const SCRIPT_WITH_CIP = `${SCRIPT_WITHOUT_CIP}\ntar -czf "$BACKUP_DIR/cip/$STAMP.tar.gz" -C "$CIP_SHEETS_DIR" .\n`;

const EXPOSURE = {
  'find /home/alloutdoor/data/cip -type f': { exitCode: 0, stdout: '/home/alloutdoor/data/cip/a.pdf\n/home/alloutdoor/data/cip/b.pdf\n' },
  'du -sb /home/alloutdoor/data/cip': { exitCode: 0, stdout: '10485760\t/home/alloutdoor/data/cip\n' },
};

test('the CIP directory is a STANDING bad while backup.sh does not mention it', async () => {
  const ctx = fakeContext({
    files: { '/app/infra/backup/backup.sh': SCRIPT_WITHOUT_CIP },
    commands: EXPOSURE,
  });
  const result = await runOne(backupSetGapCheck, ctx);

  assert.equal(result.status, 'bad');
  // standing = it becomes a red gate upstream: no command, cannot be
  // approved, declined or dismissed. Losing this flag would turn it into
  // an approvable proposal, which is precisely what must not happen.
  assert.equal(result.standing, true);
  assert.equal(result.gateKey, 'BACKUP_SET_CIP');
  assert.match(result.verdict, /\/home\/alloutdoor\/data\/cip/);
  assert.match(result.verdict, /backup\.sh/);

  const files = result.evidence.find((e) => e.label === 'files at risk');
  const size = result.evidence.find((e) => e.label === 'size at risk');
  assert.equal(files?.value, '2');
  assert.equal(size?.value, '10.0 MiB');
});

test('it clears only when the SCRIPT changes — not when the directory happens to be empty', async () => {
  const empty = fakeContext({
    files: { '/app/infra/backup/backup.sh': SCRIPT_WITHOUT_CIP },
    commands: {
      'find /home/alloutdoor/data/cip -type f': { exitCode: 0, stdout: '' },
      'du -sb /home/alloutdoor/data/cip': { exitCode: 0, stdout: '0\t/home/alloutdoor/data/cip\n' },
    },
  });
  const stillBad = await runOne(backupSetGapCheck, empty);
  assert.equal(stillBad.status, 'bad');
  assert.equal(stillBad.standing, true);

  const fixed = fakeContext({ files: { '/app/infra/backup/backup.sh': SCRIPT_WITH_CIP }, commands: EXPOSURE });
  const cleared = await runOne(backupSetGapCheck, fixed);
  assert.equal(cleared.status, 'ok');
  assert.equal(cleared.standing, false);
});

test('an unreadable backup script is unknown — it must not claim the gap is closed OR open', async () => {
  const result = await runOne(backupSetGapCheck, fakeContext({ commands: EXPOSURE }));
  assert.equal(result.status, 'unknown');
  assert.match(result.reason ?? '', /backup script/);
});

test('an unmeasurable exposure is an em dash, not a zero', async () => {
  // find and du both fail; the gap itself is still a fact, but the file
  // count must not read as "0 files at risk".
  const ctx = fakeContext({ files: { '/app/infra/backup/backup.sh': SCRIPT_WITHOUT_CIP } });
  const result = await runOne(backupSetGapCheck, ctx);
  assert.equal(result.status, 'bad');
  const files = result.evidence.find((e) => e.label === 'files at risk')!;
  assert.match(files.value, /^— \(not measured: /);
});
