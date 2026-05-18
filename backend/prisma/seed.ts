import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

const categories = [
  // Firearms (dealer transfer required for shipping)
  { name: 'Pistols', slug: 'pistols', isFirearm: true, sortOrder: 1 },
  { name: 'Rifles', slug: 'rifles', isFirearm: true, sortOrder: 2 },
  { name: 'Shotguns', slug: 'shotguns', isFirearm: true, sortOrder: 3 },
  { name: 'Barrels & Parts', slug: 'barrels-parts', isFirearm: true, sortOrder: 4 },

  // Non-firearm — Pudo/TCG eligible
  { name: 'Air Rifles', slug: 'air-rifles', isFirearm: false, sortOrder: 5 },
  { name: 'Optics & Scopes', slug: 'optics-scopes', isFirearm: false, sortOrder: 6 },
  { name: 'Holsters & Cases', slug: 'holsters-cases', isFirearm: false, sortOrder: 7 },
  { name: 'Safes & Storage', slug: 'safes-storage', isFirearm: false, sortOrder: 8 },
  { name: 'Accessories', slug: 'accessories', isFirearm: false, sortOrder: 9 },
  // Empty brass, projectiles/bullets allowed; live ammo, primers, propellant banned
  { name: 'Ammunition Components', slug: 'ammunition-components', isFirearm: false, sortOrder: 10 },
  { name: 'Hunting', slug: 'hunting', isFirearm: false, sortOrder: 11 },
  { name: 'Clothing & Gear', slug: 'clothing-gear', isFirearm: false, sortOrder: 12 },
  { name: 'Books & Training', slug: 'books-training', isFirearm: false, sortOrder: 13 },
];

async function main() {
  console.log('Seeding categories…');
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      create: cat,
      update: { name: cat.name, isFirearm: cat.isFirearm, sortOrder: cat.sortOrder },
    });
    console.log(`  ✓ ${cat.name}`);
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
