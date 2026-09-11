// Clear an admin's second factor and end every session they hold.
//
// Usage:
//   node scripts/admin-reset-totp.mjs <email>
//   node scripts/admin-reset-totp.mjs <email> --unlock
//
// ⚠️ THIS SCRIPT IS THE REAL BACKSTOP OF THE WHOLE ADMIN AUTH DESIGN, AND IT
// IS DELIBERATELY NOT A ROUTE. Everything else in that design assumes the
// Desk is reachable: recovery codes assume the piece of paper still exists,
// the lockout assumes the attack stops, TOTP assumes the phone is in a
// pocket. When none of those holds, the thing that gets the operator back in
// is a shell on the production box — which is the strongest authentication in
// this system, because it needs a key that is not the password, is not the
// phone, and is not reachable from the internet through the Desk at all.
//
// ⚠️ THERE IS NO EMAIL OR SMS RESET AND THERE MUST NOT BE. SIM-swap fraud is
// endemic in South Africa: a recovery path ending at a phone number is one an
// attacker can buy at a network shop counter, and this account approves
// commands that run on the production box. Adding an "email me a reset link"
// route would quietly make the weakest channel the one that matters.
//
// WHAT IT DOES, and equally what it does NOT:
//   * clears totpSecret and totpConfirmedAt        → next sign-in is
//     password-only (unless ADMIN_TOTP_REQUIRED is on, in which case the
//     session it issues is read-only until they re-enrol — which is exactly
//     what you want them to do next);
//   * deletes every unused recovery code           → they answered to a secret
//     that no longer exists, and a live code for a dead factor is a bearer
//     credential with no owner;
//   * revokes every AdminSession                   → a reset that left the
//     attacker's session running would have reset nothing;
//   * --unlock also clears failedLoginCount/lockedUntil, for when the reason
//     you are on the box is that somebody is holding the Desk shut.
//
// It does NOT change the password. That is `scripts/create-admin.mjs --reset`,
// on purpose: two separate operations, so clearing a lost phone does not
// silently invalidate a password the operator still has and still uses.
//
// ⚠️ IT WRITES AN AdminAuditEvent ATTRIBUTED TO THE TARGET THEMSELVES,
// because there is no admin identity behind a shell — whoever ran this had
// root. The reason string says so. An action this powerful leaving no trace
// at all would be worse than one whose actor field is imprecise.
//
// On the box:
//   ssh alloutdoor
//   cd /home/alloutdoor/app/backend && node scripts/admin-reset-totp.mjs ops@alloutdoor.co.za

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hostname, userInfo } from 'node:os';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const args = process.argv.slice(2);
const unlock = args.includes('--unlock');
const email = args.filter((a) => !a.startsWith('--'))[0]?.trim().toLowerCase();

if (!email) {
  console.error(`${c.red}Missing email arg.${c.reset}`);
  console.error('Usage: node scripts/admin-reset-totp.mjs <email> [--unlock]');
  process.exit(1);
}

const admin = await prisma.adminUser.findUnique({
  where: { email },
  select: {
    id: true,
    email: true,
    role: true,
    isActive: true,
    totpConfirmedAt: true,
    failedLoginCount: true,
    lockedUntil: true,
  },
});

if (!admin) {
  console.error(`${c.red}No AdminUser with email ${email}.${c.reset}`);
  await prisma.$disconnect();
  process.exit(2);
}

const [, codes, sessions] = await prisma.$transaction([
  prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      totpSecret: null,
      totpConfirmedAt: null,
      ...(unlock ? { failedLoginCount: 0, lockedUntil: null } : {}),
    },
  }),
  prisma.adminRecoveryCode.deleteMany({ where: { adminUserId: admin.id } }),
  prisma.adminSession.updateMany({
    where: { adminUserId: admin.id, revokedAt: null },
    data: { revokedAt: new Date() },
  }),
]);

// Best-effort: an audit insert that fails must not make the operator think
// the reset itself failed, because the reset has already committed above.
try {
  await prisma.adminAuditEvent.create({
    data: {
      adminUserId: admin.id,
      action: 'ADMIN_TOTP_RESET',
      resourceType: 'AdminUser',
      resourceId: admin.id,
      oldValue: JSON.stringify({
        totpEnrolled: Boolean(admin.totpConfirmedAt),
        failedLoginCount: admin.failedLoginCount,
        lockedUntil: admin.lockedUntil,
      }),
      newValue: JSON.stringify({
        recoveryCodesDeleted: codes.count,
        sessionsRevoked: sessions.count,
        unlocked: unlock,
      }),
      reason: `Second factor cleared from a shell on the box by ${userInfo().username}@${hostname()} (scripts/admin-reset-totp.mjs). No Desk admin identity is available for a shell action.`,
    },
  });
} catch (err) {
  console.error(`${c.yellow}⚠ Reset succeeded but the audit row failed: ${err.message}${c.reset}`);
}

console.log(`\n${c.bold}${c.green}✓ Second factor cleared for ${admin.email}${c.reset}`);
console.log(`${c.dim}  role: ${admin.role}   active: ${admin.isActive}${c.reset}`);
console.log(`${c.dim}  recovery codes deleted: ${codes.count}${c.reset}`);
console.log(`${c.dim}  sessions revoked: ${sessions.count}${c.reset}`);
if (unlock) console.log(`${c.dim}  lockout cleared${c.reset}`);

console.log(`\n${c.bold}${c.cyan}Next:${c.reset}`);
console.log(`  1. Sign in at https://alloutdoor.co.za/admin/login with the password.`);
console.log(`  2. POST /admin/auth/totp/enrol, scan the QR, POST /admin/auth/totp/confirm.`);
console.log(`  3. ${c.bold}Write the ten recovery codes down.${c.reset} They are shown once.`);
console.log(`${c.dim}  While ADMIN_TOTP_REQUIRED is on, the session issued in step 1 can`);
console.log(`  read but not write until step 2 is done and they sign in again.${c.reset}\n`);

await prisma.$disconnect();
