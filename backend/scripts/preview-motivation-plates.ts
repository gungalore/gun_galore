import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { MotivationLicenceType } from '@prisma/client';
import { LlmService } from '../src/common/llm/llm.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  PLATES_PROMPT_VERSION,
  buildPlateSpecs,
  purposeFor,
  type PlateContext,
} from '../src/motivations/motivation-plates';
import { PLATE_REQUEST_RATIO } from '../src/motivations/motivation-plates.service';

// ────────────────────────────────────────────────────────────────────
// SEE THE PLATES BEFORE THE MEMBERS DO.
//
//   cd backend
//   npm run motivation:plates:preview                 # prompts only
//   npm run motivation:plates:preview -- --draw       # 2 plates a case
//   npm run motivation:plates:preview -- --draw --case hunt --limit 4
//
// ⚠️ IT BUILDS THE REAL PROMPTS. Every string comes from buildPlateSpecs and
// the same imageBrief the generation path uses, so this cannot drift from what
// a pack will send. The cases are worked examples, not member data.
//
// ⚠️ IT DOES NOT TOUCH THE DATABASE OR THE LEDGER. The preview is a dev tool;
// the LlmService ledger write goes to a no-op stub so the spend is not booked
// against a motivation that does not exist. The API call itself is real and
// costs the same $0.08 a production plate costs.
// ────────────────────────────────────────────────────────────────────

const PER_IMAGE_USD = 0.08;
const STORE_W = 1800;
const STORE_H = 900;
const TIMEOUT_MS = 180_000;

interface PreviewCase {
  key: string;
  title: string;
  ctx: PlateContext;
}

const CASES: PreviewCase[] = [
  {
    key: 'hunt',
    title: 'Section 16 hunter — .308 bolt-action',
    ctx: {
      licenceType: MotivationLicenceType.S16_DEDICATED_HUNTER,
      answers: {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt action',
        firearm_calibre: '.308 WINCHESTER',
        hunt_game_class: 'plains_medium',
        // A held sport rifle of the same class makes this application the
        // hunting gap — see motivation-purpose.ts.
        existing_firearm_1_type: 'Rifle',
        existing_firearm_1_calibre: '6.5 CREEDMOOR',
        existing_firearm_1_use: 'sport competition',
      },
      research:
        'Well matched to impala, kudu and gemsbok at bushveld distances.',
    },
  },
  {
    key: 'sport',
    title: 'Section 16 sport — 9 mm self-loading handgun',
    ctx: {
      licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
      answers: {
        firearm_type: 'Handgun',
        firearm_action: 'Semi-automatic (self-loading)',
        firearm_calibre: '9MM PAR (9X19MM)',
      },
    },
  },
  {
    key: 'defence',
    title: 'Section 13 self-defence — townhouse complex',
    ctx: {
      licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
      answers: {
        residence_type: 'Townhouse in a security complex',
        daily_movements: 'Commute by car through the N2 every weekday',
        threat_circumstances:
          'The complex gate is shared and the parking area is dim at night.',
      },
    },
  },
  {
    key: 'both',
    title: 'Section 15 occasional — 6.5 Creedmoor bolt-action',
    ctx: {
      licenceType: MotivationLicenceType.S15_OCCASIONAL_HUNTER,
      answers: {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt action',
        firearm_calibre: '6.5 CREEDMOOR',
      },
      research:
        'Well matched to impala and kudu at bushveld distances, and used in ' +
        'F-Class and precision rifle competition.',
    },
  },
];

function arg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** A no-op ledger: the preview must not book spend against a member. */
const noLedger = {
  aiUsage: { create: () => Promise.resolve({}) },
} as unknown as PrismaService;

async function main(): Promise<void> {
  const wanted = new Set(
    (arg('case') ?? 'hunt,sport,defence')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const limit = Math.max(1, Number(arg('limit') ?? 2) || 2);
  const ratio = arg('ratio') ?? PLATE_REQUEST_RATIO;
  const draw = process.argv.includes('--draw');
  const outDir = path.resolve(
    process.cwd(),
    arg('out') ?? path.join('tmp', 'plate-preview'),
  );

  const chosen = CASES.filter((c) => wanted.has(c.key));
  if (!chosen.length) {
    console.error(
      `No matching case. Choose from: ${CASES.map((c) => c.key).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  const lines: string[] = [
    'MOTIVATION PURPOSE PLATES — PREVIEW',
    '',
    `promptVersion: ${PLATES_PROMPT_VERSION}`,
    `model:          grok-imagine-image-2.0 (2K, medium)`,
    `aspectRatio:    ${ratio}`,
    `plates/case:    ${limit}`,
    `checkout:       ${draw ? 'DRAW (real API calls)' : 'prompts only'}`,
    '',
    'The prompts below come from buildPlateSpecs and imageBrief — the same',
    'builders the generation path uses. The cases are worked examples, not',
    'member data.',
    '',
  ];

  let requests = 0;
  const jobs: Array<{
    caseKey: string;
    caseTitle: string;
    index: number;
    spec: ReturnType<typeof buildPlateSpecs>[number];
  }> = [];

  for (const c of chosen) {
    const purpose = purposeFor(c.ctx.licenceType, c.ctx.answers) ?? 'none';
    const specs = buildPlateSpecs(c.ctx).slice(0, limit);
    lines.push(
      `${'='.repeat(78)}`,
      `CASE ${c.key} — ${c.title}`,
      `purpose: ${purpose}   plates: ${specs.length}`,
      `${'='.repeat(78)}`,
      '',
    );

    if (!specs.length) {
      lines.push('(no plates: the pack does not support an exhibit)', '');
      continue;
    }

    specs.forEach((spec, i) => {
      requests += 1;
      jobs.push({ caseKey: c.key, caseTitle: c.title, index: i, spec });
      lines.push(
        `--- ${c.key} ${i + 1}/${specs.length}: ${spec.title} ---`,
        `page ${spec.pageIndex}, slot ${spec.plateIndex}`,
        '',
        'DESCRIPTION',
        spec.description,
        '',
        'PROMPT',
        spec.prompt,
        '',
      );
    });
  }

  const promptsPath = path.join(outDir, 'prompts.txt');
  fs.writeFileSync(promptsPath, lines.join('\n'), 'utf8');
  console.log(`Prompts: ${promptsPath}`);
  console.log(
    draw
      ? `Drawing ${requests} plates — estimated cost $${(requests * PER_IMAGE_USD).toFixed(2)}`
      : `${requests} plates available — estimated cost $${(requests * PER_IMAGE_USD).toFixed(2)} if drawn`,
  );

  if (!draw) {
    console.log('Dry run only. Add --draw to call the image API.');
    return;
  }

  const llm = new LlmService(noLedger);

  await Promise.allSettled(
    jobs.map(async (job) => {
      const base = `${job.caseKey}-${String(job.index + 1).padStart(2, '0')}-${slug(job.spec.title)}`;
      const startedAt = Date.now();
      try {
        const res = await llm.generateImage({
          prompt: job.spec.prompt,
          aspectRatio: ratio,
          purpose: 'motivation.plate',
          timeoutMs: TIMEOUT_MS,
        });
        const first = res.images[0];
        if (!first?.data) throw new Error('the model returned no image');

        const raw = Buffer.from(first.data, 'base64');
        const rawPath = path.join(outDir, `${base}-raw.jpg`);
        fs.writeFileSync(rawPath, raw);

        const plate = await sharp(raw)
          .resize(STORE_W, STORE_H, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
          .toBuffer();
        const platePath = path.join(outDir, `${base}-plate.jpg`);
        fs.writeFileSync(platePath, plate);

        console.log(
          `OK   ${base}  ${Math.round((Date.now() - startedAt) / 1000)}s  ` +
            `${Math.round(raw.length / 1024)}KB raw`,
        );
      } catch (err) {
        console.warn(`FAIL ${base}  ${(err as Error).message}`);
      }
    }),
  );

  console.log(`Images: ${outDir}`);
}

void main();
