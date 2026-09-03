// warden/src/__fixtures__/env-order-probe.ts
//
// A TEST FIXTURE, not part of the daemon. env-order.test.ts spawns this in a
// child process — a child, because ESM freezes exec/safe-list.ts's APP_ROOT the
// first time that module is evaluated, so the two orderings this proves cannot
// both be observed inside one process.
//
// It lives inside src/ rather than a temp directory for one dull but load
// -bearing reason: tsx transforms files in the project's own tree, and a .ts
// file written to os.tmpdir() fails with a TransformError. Keeping it here also
// means its imports are ordinary relative ones, so nothing about the probe is
// special-cased.
//
// argv[2] picks the ordering:
//   after  — load .env, THEN import the app tree. What src/boot.ts does.
//   before — import the app tree, THEN load .env. The bug boot.ts exists to
//            prevent, kept executable so the test can prove the two differ.
//
// It prints one line, `RESOLVED:<path>`, and exits.
//
// ⚠️ IT PROBES ARCHIVE_DIR, NOT LOG_FILES. The probe must read a constant that
// still derives from WARDEN_APP_ROOT at module scope; LOG_FILES.backendError
// stopped doing so when the pm2 log paths were corrected to ~/.pm2/logs, and a
// probe that no longer touches the thing under test passes for the wrong
// reason.

const mode = process.argv[2];

if (mode === 'after') {
  const env = await import('../env.js');
  env.loadDotEnvFile();
  const exec = await import('../exec/index.js');
  process.stdout.write(`RESOLVED:${exec.ARCHIVE_DIR}\n`);
} else if (mode === 'before') {
  // Evaluate the app tree first, exactly as a static import in boot.ts would,
  // and read the constant it froze at that moment.
  const exec = await import('../exec/index.js');
  const frozen = exec.ARCHIVE_DIR;
  const env = await import('../env.js');
  env.loadDotEnvFile();
  process.stdout.write(`RESOLVED:${frozen}\n`);
} else {
  process.stderr.write(`env-order-probe: unknown mode ${String(mode)}\n`);
  process.exit(2);
}
