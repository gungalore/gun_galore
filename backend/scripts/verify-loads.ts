/**
 * Smoke-test the real RecommendedLoadsService against the live DB. Exercises the
 * shared cartridgeKey normalizer + the recommend() grouping/ladder logic exactly
 * as the API does. Usage:  npx ts-node scripts/verify-loads.ts "6.5 Creedmoor" 139
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { RecommendedLoadsService } from '../src/load-lab/recommended-loads.service';

async function main() {
  const cartridge = process.argv[2] ?? '6.5 Creedmoor';
  const weight = Number(process.argv[3] ?? 139);
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL!),
  });
  const svc = new RecommendedLoadsService(prisma as never);
  const res = await svc.recommend(cartridge, weight, 5);
  console.log(
    `\n${cartridge} @ ${weight}gr (±5) — notIndexed=${res.notIndexed}, ${res.powders.length} powders`,
  );
  for (const p of res.powders.slice(0, 14)) {
    const vel =
      p.startVelFps || p.maxVelFps
        ? `${p.startVelFps ?? '?'}-${p.maxVelFps ?? '?'}fps`
        : 'vel n/a';
    console.log(
      `  ${p.isSomchem ? 'SA' : '  '}[${String(p.manualCount).padStart(2)} man] ${(p.powderMaker + ' ' + p.powderName).trim().padEnd(20)} ${p.startGr}-${p.maxGr}gr ` +
        `+${p.incrementGr}x${p.steps} ${vel}${p.singleCharge ? ' [max-only]' : ''} ` +
        `· ${p.bulletWeightGr}gr ${p.bulletName ?? ''} — ${p.manual} p${p.pageNumber}`,
    );
  }
  console.log('\nsources:', res.sources.join(' | '));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
