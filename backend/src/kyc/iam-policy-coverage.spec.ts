// backend/src/kyc/iam-policy-coverage.spec.ts
//
// Every AWS call the code makes must be granted by the IAM policy we ship.
//
// WHY THIS EXISTS. The policy drifted from the code and nothing noticed: the
// service gained an AssumeRole path while `sts:AssumeRole` was missing from
// the policy, so the feature would have failed with AccessDenied the moment
// anyone set AWS_KYC_LIVENESS_ROLE_ARN. Nothing catches that — not tsc, not
// the unit tests, not a deploy. It surfaces as a runtime error on a seller's
// verification attempt, which is the worst possible place to find it.
//
// So this reads the SOURCE for the commands it actually constructs, maps each
// to its IAM action, and checks the policy allows it. Adding a new AWS call
// without granting it now fails here instead of in production.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_FILE = join(__dirname, 'aws-kyc.service.ts');
const POLICY_FILE = join(
  __dirname,
  '..',
  '..',
  '..',
  'infra',
  'aws',
  'kyc-iam-policy.json',
);

interface Statement {
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Sid?: string;
}

const source = readFileSync(SERVICE_FILE, 'utf8');
const policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8')) as {
  Statement: Statement[];
};

/**
 * Which SDK package each command was imported from, so `CompareFacesCommand`
 * becomes `rekognition:CompareFaces` rather than being guessed at by name.
 * Derived from the import statements themselves — a command moved to a
 * different client is then re-derived rather than silently mis-attributed.
 */
function commandToAction(): Map<string, string> {
  const map = new Map<string, string>();
  const importRe =
    /import\s*\{([^}]+)\}\s*from\s*'@aws-sdk\/client-([a-z0-9-]+)'/g;
  for (const [, names, service] of source.matchAll(importRe)) {
    for (const raw of names.split(',')) {
      const name = raw.trim().replace(/^type\s+/, '');
      if (!name.endsWith('Command')) continue;
      map.set(name, `${service}:${name.slice(0, -'Command'.length)}`);
    }
  }
  return map;
}

function commandsUsed(): string[] {
  return [
    ...new Set(
      [...source.matchAll(/new ([A-Za-z]+Command)\(/g)].map((m) => m[1]),
    ),
  ];
}

const allowed = new Set(
  policy.Statement.filter((s) => s.Effect === 'Allow').flatMap((s) =>
    Array.isArray(s.Action) ? s.Action : [s.Action],
  ),
);

describe('the shipped IAM policy covers what the code calls', () => {
  const actions = commandToAction();

  it('resolves every constructed command to an IAM action', () => {
    // A command this cannot attribute would be silently skipped by the test
    // below, which would make the whole guard worthless.
    const unresolved = commandsUsed().filter((c) => !actions.has(c));
    expect(unresolved).toEqual([]);
  });

  it.each(commandsUsed())('%s is granted by kyc-iam-policy.json', (command) => {
    const action = actions.get(command);
    expect(action).toBeDefined();
    expect(allowed.has(action as string)).toBe(true);
  });

  it('the browser challenge action is granted, since federation can only narrow', () => {
    // StartFaceLivenessSession is never called by this server — the BROWSER
    // makes it. But GetFederationToken hands down the intersection of the
    // session policy and the caller's own, so the user must hold it for the
    // browser to be given it. Removing it here breaks liveness in a way that
    // shows up only in a browser, with no server-side error at all.
    expect(allowed.has('rekognition:StartFaceLivenessSession')).toBe(true);
  });

  it('the region lock still covers both vision services', () => {
    const deny = policy.Statement.find((s) => s.Effect === 'Deny');
    const denied = Array.isArray(deny?.Action) ? deny.Action : [deny?.Action];
    expect(denied).toEqual(
      expect.arrayContaining(['textract:*', 'rekognition:*']),
    );
    // ⚠️ AND MUST NOT COVER sts. The deny is region-conditioned, and an
    // over-broad `*` here would block the credential vending that makes the
    // liveness challenge possible at all.
    expect(denied.join(' ')).not.toMatch(/sts/);
  });
});
