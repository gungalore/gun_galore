import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

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

// Test dealers — replace with real SAPS-licensed dealers before production launch.
// Coordinates are approximate city centres.
const dealers = [
  {
    licenceNumber: 'TEST-GP-001',
    name: 'Centurion Arms & Ammo',
    address: '123 John Vorster Drive',
    suburb: 'Centurion',
    city: 'Centurion',
    province: 'GAUTENG' as const,
    postalCode: '0157',
    lat: -25.8553,
    lng: 28.1881,
    phone: '012 000 0001',
    email: 'info@centurionarms.test',
  },
  {
    licenceNumber: 'TEST-GP-002',
    name: 'Joburg Firearms & Accessories',
    address: '456 Commissioner Street',
    suburb: 'Johannesburg CBD',
    city: 'Johannesburg',
    province: 'GAUTENG' as const,
    postalCode: '2001',
    lat: -26.2041,
    lng: 28.0473,
    phone: '011 000 0002',
    email: 'info@joburgfirearms.test',
  },
  {
    licenceNumber: 'TEST-WC-001',
    name: 'Cape Arms Dealers',
    address: '789 Voortrekker Road',
    suburb: 'Bellville',
    city: 'Cape Town',
    province: 'WESTERN_CAPE' as const,
    postalCode: '7530',
    lat: -33.9249,
    lng: 18.4241,
    phone: '021 000 0003',
    email: 'info@capearmstest.test',
  },
  {
    licenceNumber: 'TEST-KZN-001',
    name: 'Durban Firearms Centre',
    address: '321 Old Main Road',
    suburb: 'Pinetown',
    city: 'Durban',
    province: 'KWAZULU_NATAL' as const,
    postalCode: '3610',
    lat: -29.8179,
    lng: 30.8593,
    phone: '031 000 0004',
    email: 'info@durbanfirearms.test',
  },
  {
    licenceNumber: 'TEST-EC-001',
    name: 'Port Elizabeth Arms',
    address: '654 Uitenhage Road',
    suburb: 'Korsten',
    city: 'Port Elizabeth',
    province: 'EASTERN_CAPE' as const,
    postalCode: '6020',
    lat: -33.9608,
    lng: 25.6022,
    phone: '041 000 0005',
    email: 'info@pearms.test',
  },
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

  console.log('Seeding dealers…');
  for (const dealer of dealers) {
    await prisma.dealer.upsert({
      where: { licenceNumber: dealer.licenceNumber },
      create: dealer,
      update: {
        name: dealer.name,
        address: dealer.address,
        suburb: dealer.suburb,
        city: dealer.city,
        province: dealer.province,
        postalCode: dealer.postalCode,
        lat: dealer.lat,
        lng: dealer.lng,
        phone: dealer.phone,
        email: dealer.email,
      },
    });
    console.log(`  ✓ ${dealer.name}`);
  }

  console.log('Seeding superadmin…');
  const hash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD ?? 'Admin@GunGalore1!', 10);
  await prisma.adminUser.upsert({
    where: { email: 'admin@gungalore.co.za' },
    update: {},
    create: {
      email: 'admin@gungalore.co.za',
      passwordHash: hash,
      role: 'SUPERADMIN',
      firstName: 'Super',
      lastName: 'Admin',
    },
  });
  console.log('  ✓ admin@gungalore.co.za (SUPERADMIN)');

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
