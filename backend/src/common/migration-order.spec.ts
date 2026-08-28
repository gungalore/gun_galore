import * as fs from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// THE MIGRATION CHAIN MUST REPLAY INTO AN EMPTY DATABASE.
//
// This test exists because it did not, and nobody noticed for nine days.
//
// `20260819160000_credential_hunter_kinds` ran `ALTER TYPE "CredentialKind"
// ADD VALUE`, and the type was created by `20260820090000_licence_centre` —
// which sorts AFTER it. Production never cared: the two were applied
// historically in a working order. But `prisma migrate deploy` against a fresh
// database applies strictly in folder order, so it died on migration 13 of 48
// with `ERROR: type "CredentialKind" does not exist`, and no one could build a
// working local database from this repository at all.
//
// It was found by accident, while validating an unrelated migration.
//
// ⚠️ THE FAILURE IS INVISIBLE TO EVERY OTHER CHECK. Nothing else in this suite
// touches a database, production is already past it, and the developer's own
// machine — which is how this would normally surface — was itself too far
// behind to reach that migration. So it is checked statically, here, against
// the files themselves.
//
// WHAT THIS CANNOT DO: it parses SQL with regular expressions, so it is a
// smoke alarm and not a compiler. A green run means "no obvious forward
// reference", not "this chain definitely applies". The real proof is still
// `prisma migrate deploy` into an empty database.
// ────────────────────────────────────────────────────────────────────

const MIGRATIONS = path.join(process.cwd(), 'prisma', 'migrations');

interface Migration {
  folder: string;
  sql: string;
}

function load(): Migration[] {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => fs.existsSync(path.join(MIGRATIONS, f, 'migration.sql')))
    .sort() // Prisma applies in lexicographic folder order. So do we.
    .map((folder) => ({
      folder,
      sql: fs
        .readFileSync(path.join(MIGRATIONS, folder, 'migration.sql'), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n'),
    }));
}

/** Everything a migration needs to already exist. */
function references(sql: string): { types: Set<string>; tables: Set<string> } {
  const types = new Set<string>();
  const tables = new Set<string>();
  for (const m of sql.matchAll(/ALTER\s+TYPE\s+"([^"]+)"/gi)) types.add(m[1]);
  // A column declared with an enum type: "col" "TypeName"
  for (const m of sql.matchAll(/"\w+"\s+"([A-Z]\w+)"(\[\])?/g)) types.add(m[1]);
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)) {
    tables.add(m[1]);
  }
  for (const m of sql.matchAll(/REFERENCES\s+"([^"]+)"/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/\bUPDATE\s+"([^"]+)"/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/\bINSERT\s+INTO\s+"([^"]+)"/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/\bFROM\s+"([^"]+)"/gi)) tables.add(m[1]);
  return { types, tables };
}

/** Everything a migration brings into existence. */
function creates(sql: string): { types: string[]; tables: string[] } {
  return {
    types: [...sql.matchAll(/CREATE\s+TYPE\s+"([^"]+)"/gi)].map((m) => m[1]),
    tables: [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)].map(
      (m) => m[1],
    ),
  };
}

describe('the migration chain replays into an empty database', () => {
  const migrations = load();

  it('finds the migrations at all', () => {
    // If this ever reads zero, every other test here passes vacuously.
    expect(migrations.length).toBeGreaterThan(40);
    expect(migrations[0].folder).toMatch(/^\d{8}/);
  });

  it('never references a type or table an earlier migration has not created', () => {
    const haveTypes = new Set<string>();
    const haveTables = new Set<string>();
    const problems: string[] = [];

    for (const { folder, sql } of migrations) {
      const need = references(sql);
      const made = creates(sql);

      for (const type of need.types) {
        if (!haveTypes.has(type) && !made.types.includes(type)) {
          problems.push(`${folder}: uses type "${type}" before anything creates it`);
        }
      }
      for (const table of need.tables) {
        if (!haveTables.has(table) && !made.tables.includes(table)) {
          problems.push(`${folder}: uses table "${table}" before anything creates it`);
        }
      }

      for (const t of made.types) haveTypes.add(t);
      for (const t of made.tables) haveTables.add(t);
    }

    // Listed in full rather than counted — the folder name is the whole fix.
    expect(problems).toEqual([]);
  });

  it('creates a type twice only behind a duplicate_object guard', () => {
    // ⚠️ TWO CREATE TYPEs FOR ONE NAME IS FINE, BUT ONLY GUARDED. Both
    // CredentialKind statements sit inside
    // `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    // so whichever runs first wins and the other does nothing. A bare second
    // CREATE TYPE would fail on a fresh database and pass in production, which
    // is the same trap as the ordering bug this file exists for.
    const seen = new Map<string, string>();
    const unguarded: string[] = [];

    for (const { folder, sql } of migrations) {
      for (const type of creates(sql).types) {
        const first = seen.get(type);
        if (first) {
          const guarded = /EXCEPTION\s+WHEN\s+duplicate_object/i.test(sql);
          if (!guarded) {
            unguarded.push(`${folder}: re-creates type "${type}" (first in ${first})`);
          }
        } else {
          seen.set(type, folder);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('names every migration with a full timestamp so ordering is unambiguous', () => {
    // ⚠️ A BARE DATE SORTS AFTER EVERY SAME-DAY TIMESTAMP, because an
    // underscore sorts after every digit. `20260827_offers_on_any_listing` is
    // the one that already exists; it is applied in production and cannot be
    // renamed, so it is grandfathered rather than fixed.
    const GRANDFATHERED = ['20260827_offers_on_any_listing'];
    const bad = migrations
      .map((m) => m.folder)
      .filter((f) => !/^\d{14}_/.test(f))
      .filter((f) => !GRANDFATHERED.includes(f));
    expect(bad).toEqual([]);
  });
});
