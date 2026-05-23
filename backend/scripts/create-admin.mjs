// Create a new SUPERADMIN account in the production DB.
//
// Usage:
//   node scripts/create-admin.mjs <email> [first-name] [last-name]
//
// Example:
//   node scripts/create-admin.mjs admin@gungalore.co.za Gerhard Fourie
//
// The script generates a strong random password, hashes it with
// bcrypt (matching what AdminAuthService.login expects), and prints
// the password ONCE to stdout. Save it before the terminal scrolls
// past — there's no way to recover it later (only reset).
//
// If an AdminUser with the same email already exists, the script
// REFUSES to overwrite by default. Pass `--reset` to instead reset
// the password on the existing record.

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
const passwordHash = await bcrypt.hash(password, 10);

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
    data: { passwordHash, isActive: true },
  });
  console.log(`\n${c.bold}${c.green}✓ Password reset for ${email}${c.reset}`);
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
console.log(`${c.bold}  Admin login at: https://gungalore.co.za/admin/login${c.reset}`);
console.log(`${c.bold}    Email:    ${c.reset}${email}`);
console.log(`${c.bold}    Password: ${c.reset}${c.yellow}${password}${c.reset}`);
console.log(`${c.bold}${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
console.log(`${c.dim}  Save the password now — it's not recoverable.${c.reset}\n`);

await prisma.$disconnect();
