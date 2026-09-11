// Create a new SUPERADMIN account in the production DB.
//
// Usage:
//   node scripts/create-admin.mjs <email> [first-name] [last-name]
//
// Example:
//   node scripts/create-admin.mjs ops@alloutdoor.co.za Gerhard Fourie
//
// The script generates a strong random password, hashes it with
// bcrypt (matching what AdminAuthService.login expects), and prints
// the password ONCE to stdout. Save it before the terminal scrolls
// past — there's no way to recover it later (only reset).
//
// If an AdminUser with the same email already exists, the script
// REFUSES to overwrite by default. Pass `--reset` to instead reset
// the password on the existing record.
//
// ⚠️ THIS SCRIPT IS THE ONLY WAY AN ADMIN PASSWORD GETS SET IN THE FIRST
// PLACE, and that is deliberate rather than a gap. `AdminService.createAdmin`
// (the Desk's "add an admin" button) writes a hash of 24 random bytes that
// nobody has ever seen, so an account created that way cannot sign in until
// somebody with a shell on the box runs this with --reset. Setting somebody
// else's password is a shell operation on purpose: a Full admin who could set
// another Full admin's password could sign in as them, and every audit row
// after that would name the wrong person. Once they are in, they rotate it
// themselves at POST /admin/auth/password.
//
// ⚠️ IT DOES NOT TOUCH THE SECOND FACTOR. Resetting a password for somebody
// who has lost their phone leaves them exactly as locked out as before —
// that is `scripts/admin-reset-totp.mjs`, which is a separate operation so
// that neither one silently undoes the other.
//
// ⚠️ --reset ALSO ENDS EVERY SESSION THAT ACCOUNT HOLDS. A password reset
// that left the previous holder's session running would not have locked
// anybody out, which is the only reason anyone resets a password in a hurry.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const positional = args.filter((a) => !a.startsWith('--'));
const email = positional[0]?.toLowerCase();
const firstName = positional[1] ?? null;
const lastName = positional[2] ?? null;

if (!email) {
  console.error(`${c.red}Missing email arg.${c.reset}`);
  console.error('Usage: node scripts/create-admin.mjs <email> [first-name] [last-name] [--reset]');
  process.exit(1);
}

// Generate a memorable-ish random password: 20 base32-ish chars.
// Easy to dictate, no ambiguous chars (0/O, 1/l/I), enough entropy
// (~100 bits) to be a real password.
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const password = generatePassword();
// ⚠️ COST 12, MATCHING BCRYPT_COST ON THE MEMBER SIDE. It was 10 here and in
// AdminService.createAdmin while auth.service.ts's comment claimed cost 12
// "matches the admin side" — it did not. bcrypt encodes the cost in the hash,
// so existing cost-10 rows keep verifying; they migrate the next time their
// owner changes their password.
const passwordHash = await bcrypt.hash(password, 12);

const existing = await prisma.adminUser.findUnique({ where: { email } });

if (existing && !reset) {
  console.error(`${c.red}AdminUser ${email} already exists.${c.reset}`);
  console.error(`Pass --reset to reset their password instead.`);
  await prisma.$disconnect();
  process.exit(2);
}

if (existing) {
  await prisma.adminUser.update({
    where: { email },
    data: {
      passwordHash,
      isActive: true,
      // A reset is the answer to "I have lost control of this account", so it
      // clears the brute-force lock too. Without this the operator sets a new
      // password and is still refused for up to fifteen more minutes, with a
      // message that cannot be told apart from a wrong password.
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  // ⚠️ AND EVERY SESSION THAT ACCOUNT HOLDS DIES. A password reset that left
  // the previous holder signed in would not have locked anybody out — which
  // is the only reason anyone resets a password in a hurry.
  const ended = await prisma.adminSession.updateMany({
    where: { adminUserId: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  console.log(`\n${c.bold}${c.green}✓ Password reset for ${email}${c.reset}`);
  console.log(`${c.dim}  sessions revoked: ${ended.count}${c.reset}`);
} else {
  await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      role: 'SUPERADMIN',
      isActive: true,
    },
  });
  console.log(`\n${c.bold}${c.green}✓ Created SUPERADMIN ${email}${c.reset}`);
}

console.log(`\n${c.bold}${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
// ⚠️ alloutdoor.co.za, NOT gungalore.co.za. This line printed the retired
// domain, whose hosts answer Cloudflare 522 — so anybody following the
// script's own output could not sign in, with nothing anywhere to say why.
console.log(`${c.bold}  Admin login at: https://alloutdoor.co.za/admin/login${c.reset}`);
console.log(`${c.bold}    Email:    ${c.reset}${email}`);
console.log(`${c.bold}    Password: ${c.reset}${c.yellow}${password}${c.reset}`);
console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
console.log(`${c.dim}  Save the password now — it's not recoverable.${c.reset}`);
console.log(`${c.dim}  Then sign in and enrol a second factor: POST /admin/auth/totp/enrol,${c.reset}`);
console.log(`${c.dim}  then /totp/confirm, and write down the ten recovery codes.${c.reset}\n`);

await prisma.$disconnect();
