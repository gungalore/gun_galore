// Enter the five WHATSAPP_* credentials into backend/.env, interactively.
//
// Usage (from backend/):
//   node scripts/whatsapp-credentials.mjs           # prompt for anything missing
//   node scripts/whatsapp-credentials.mjs --status  # report what is set, print no values
//   node scripts/whatsapp-credentials.mjs --all     # re-prompt for everything
//
// WARNING: SECRETS NEVER LEAVE THIS TERMINAL. Three of the five are
// credentials (CLAUDE.md rule 9: an exposed secret is a compromised secret --
// rotate it). So this masks them as you type, never echoes them back, never
// logs them, and --status reports only set/missing. Do not pass any of them as
// a command-line argument either: arguments land in your shell history and in
// the process list, which is the same exposure by a quieter route.
//
// WARNING: IT EDITS IN PLACE AND KEEPS A BACKUP. An existing key is rewritten
// on its own line; every other line of .env -- comments and unrelated keys
// included -- is left byte-for-byte alone, and the previous file is copied to
// .env.bak.<stamp> first. This runs against the file holding every other
// credential the backend needs, so a clobber here is an outage.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const DIGITS = /^\d{10,20}$/;
const HEX32 = /^[a-f0-9]{32}$/i;

/** The five, in the order they are easiest to collect. */
const FIELDS = [
  {
    key: 'WHATSAPP_PHONE_NUMBER_ID',
    label: 'Phone number ID',
    secret: false,
    where: 'App Dashboard > WhatsApp > API Setup -- under the "From" number.',
    validate: (v) => (DIGITS.test(v) ? null : 'expected 10-20 digits, nothing else'),
  },
  {
    key: 'WHATSAPP_WABA_ID',
    label: 'WhatsApp Business Account ID',
    secret: false,
    where: 'Same page, just below the Phone number ID.',
    validate: (v) => (DIGITS.test(v) ? null : 'expected 10-20 digits, nothing else'),
  },
  {
    key: 'WHATSAPP_TOKEN',
    label: 'System User permanent token',
    secret: true,
    where: [
      'business.facebook.com/settings > Users > System users > your user >',
      '    Generate new token > Expiration: NEVER > scopes:',
      '    whatsapp_business_messaging + whatsapp_business_management.',
      '    NOT the token on the API Setup page -- that one expires in 24h.',
    ].join('\n'),
    validate: (v) =>
      v.length < 50
        ? 'too short for a System User token -- did you copy the temporary one?'
        : null,
  },
  {
    key: 'WHATSAPP_APP_SECRET',
    label: 'App secret',
    secret: true,
    where: 'developers.facebook.com > your App > Settings > Basic > App secret > Show.',
    validate: (v) =>
      HEX32.test(v) ? null : 'expected 32 hex characters -- check you copied all of it',
  },
  {
    key: 'WHATSAPP_VERIFY_TOKEN',
    label: 'Webhook verify token',
    secret: true,
    where: [
      'You invent this one. Press ENTER on its own and a strong random value',
      '    is generated for you -- then paste the SAME value into Meta at',
      '    App > WhatsApp > Configuration. They only have to match each other.',
    ].join('\n'),
    generate: () => randomBytes(24).toString('hex'),
    validate: (v) => (v.length >= 16 ? null : 'use at least 16 characters'),
  },
];

const readEnv = () => (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '');

/** True when the key exists AND carries a non-empty value. */
function isSet(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return !!m && clean(m[1]).length > 0;
}

/** A pasted value usually arrives with stray whitespace or wrapping quotes. */
function clean(raw) {
  return String(raw).trim().replace(/^["']+|["']+$/g, '').trim();
}

/** Rewrite one key in place, or append it. Everything else is untouched. */
function upsert(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  const banner = text.includes('# WhatsApp: Meta Cloud API')
    ? ''
    : '\n# WhatsApp: Meta Cloud API\n';
  return `${text.replace(/\n*$/, '\n')}${banner}${line}\n`;
}

// ONE readline for the whole session, not one per question.
//
// A fresh interface per prompt looks tidier and is subtly broken: the first
// one buffers everything already on stdin, so the next one -- reading the same
// fd -- gets nothing and the script hangs on question two. Invisible against a
// slow human typist, immediate the moment input is piped or pasted as a block.
//
// `terminal` follows the real stdin rather than being forced on: forced true
// over a pipe makes readline treat the whole stream as one line and then hand
// back EOF, which looks exactly like the script hanging. Masking only means
// anything on a terminal anyway -- there is no one watching a pipe.
const isTty = process.stdin.isTTY === true;
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: isTty,
});

// Lines are QUEUED rather than read on demand.
//
// readline emits every line the stream already holds as fast as it can, and
// `rl.question` only ever catches the next one -- so anything that arrived
// while we were not asking is dropped on the floor. That is invisible while a
// human types one line at a time and total the moment input is pasted as a
// block or piped, which is also the only way this script can be tested.
const queue = [];
let pending = null;
/** Set once stdin ends, so a half-finished run still saves what it collected. */
let inputEnded = false;

rl.on('line', (line) => {
  if (pending) {
    const resolve = pending;
    pending = null;
    resolve(line);
  } else {
    queue.push(line);
  }
});

rl.on('close', () => {
  inputEnded = true;
  if (pending) {
    const resolve = pending;
    pending = null;
    resolve('');
  }
});

/** Set while a secret is being typed, read by the output override below. */
let masking = null;

// readline has no masked mode; overriding the output writer is the standard
// way to get one, and it keeps backspace working.
if (isTty) {
  const writeOut = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => {
    if (masking === null || s.includes(masking) || s === '\n' || s === '\r\n') {
      writeOut(s);
      return;
    }
    rl.output.write('*');
  };
}

function ask(question, { secret = false } = {}) {
  if (queue.length > 0) return Promise.resolve(queue.shift());
  if (inputEnded) return Promise.resolve('');
  process.stdout.write(question);
  masking = secret && isTty ? question : null;
  return new Promise((done) => {
    pending = (answer) => {
      masking = null;
      if (secret && isTty) process.stdout.write('\n');
      done(answer);
    };
  });
}

function report(text) {
  for (const f of FIELDS) {
    console.log(`  ${isSet(text, f.key) ? '[set]    ' : '[missing]'}  ${f.key}`);
  }
}

async function collect(field) {
  console.log(`${field.key}  -- ${field.label}`);
  console.log(`    ${field.where}`);
  for (;;) {
    const raw = clean(await ask('  > ', { secret: field.secret }));
    if (!raw) {
      // A blank means "generate one" only when a person actually pressed
      // ENTER. At EOF it means there is nobody there, and silently minting a
      // verify token nobody saw would be worse than leaving the key unset.
      if (field.generate && !inputEnded) {
        console.log('    generated a random value for you.\n');
        return field.generate();
      }
      console.log(inputEnded ? '    input ended -- skipped.\n' : '    skipped.\n');
      return null;
    }
    const problem = field.validate?.(raw);
    if (problem) {
      console.log(`    x ${problem}`);
      const anyway = clean(await ask('    use it anyway? (y/N) ')).toLowerCase();
      if (anyway !== 'y') continue;
    }
    console.log('    recorded.\n');
    return raw;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const reaskAll = args.includes('--all');

  let text = readEnv();
  if (!existsSync(ENV_PATH)) {
    console.log(`\nNote: ${ENV_PATH} does not exist -- it will be created.`);
  }

  console.log('\nWhatsApp credentials -> backend/.env\n');
  report(text);
  console.log('');

  if (statusOnly) {
    console.log('--status: nothing written, no values printed.\n');
    return;
  }

  const todo = FIELDS.filter((f) => reaskAll || !isSet(text, f.key));
  if (todo.length === 0) {
    console.log('All five are already set. Re-run with --all to replace them.\n');
    return;
  }

  console.log('Secrets are masked as you type and are never echoed back.');
  console.log('Leave a prompt blank to skip it for now.\n');

  const entered = [];
  for (const field of todo) {
    const value = await collect(field);
    if (value) entered.push([field.key, value]);
  }

  if (entered.length === 0) {
    console.log('Nothing entered -- .env untouched.\n');
    return;
  }

  if (existsSync(ENV_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${ENV_PATH}.bak.${stamp}`;
    copyFileSync(ENV_PATH, backup);
    console.log(`Backed up .env -> ${backup.split(/[\\/]/).pop()}`);
  }

  for (const [key, value] of entered) text = upsert(text, key, value);
  writeFileSync(ENV_PATH, text, 'utf8');

  console.log(`Wrote ${entered.length} value(s) to backend/.env\n`);
  report(text);

  if (entered.some(([k]) => k === 'WHATSAPP_VERIFY_TOKEN')) {
    console.log(
      [
        '',
        'The verify token must ALSO be pasted into Meta:',
        '    App > WhatsApp > Configuration > Webhook > Edit.',
        '    Read it back with:  grep ^WHATSAPP_VERIFY_TOKEN backend/.env',
        '    (not printed here -- this terminal may be shared or logged).',
      ].join('\n'),
    );
  }

  console.log(
    [
      '',
      'Nothing sends yet: the whatsapp_enabled flag is still off, so every',
      'send writes a STUB row. Turn it on from the Desk Site board once the',
      'templates are approved.',
      '',
    ].join('\n'),
  );
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}\n`);
  process.exit(1);
});
