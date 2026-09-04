// backend/src/kyc/aws-kyc.service.spec.ts
//
// Credential vending for the browser liveness challenge.
//
// This is the one place in the codebase that deliberately hands AWS
// credentials to a client, so what those credentials CANNOT do is the thing
// worth testing. The stubbed STS client keeps it off the network.

import { AwsKycService } from './aws-kyc.service';

const ROLE = 'AWS_KYC_LIVENESS_ROLE_ARN';

function serviceWithStubbedSts() {
  const svc = new AwsKycService();
  const send = jest.fn().mockResolvedValue({
    Credentials: {
      AccessKeyId: 'ASIA_TEMP',
      SecretAccessKey: 'temp-secret',
      SessionToken: 'temp-token',
      Expiration: new Date('2026-09-04T12:00:00Z'),
    },
  });
  // The client is created lazily, so pre-seeding it is what keeps this off
  // the network without having to mock the SDK module.
  (svc as unknown as { stsClient: { send: jest.Mock } }).stsClient = { send };
  return { svc, send };
}

describe('AwsKycService.vendBrowserCredentials', () => {
  const original = {
    role: process.env[ROLE],
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
  };

  beforeEach(() => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_SERVER';
    process.env.AWS_SECRET_ACCESS_KEY = 'server-secret';
  });

  afterEach(() => {
    const restore = (k: string, v: string | undefined) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore(ROLE, original.role);
    restore('AWS_ACCESS_KEY_ID', original.key);
    restore('AWS_SECRET_ACCESS_KEY', original.secret);
  });

  it('needs no IAM role — it federates from the server user by default', async () => {
    delete process.env[ROLE];
    const { svc, send } = serviceWithStubbedSts();

    const creds = await svc.vendBrowserCredentials('clerk_abc');

    expect(creds?.sessionToken).toBe('temp-token');
    expect(send.mock.calls[0][0].constructor.name).toBe(
      'GetFederationTokenCommand',
    );
  });

  it('lets the browser ONLY start a liveness stream — never read the verdict', async () => {
    delete process.env[ROLE];
    const { svc, send } = serviceWithStubbedSts();

    await svc.vendBrowserCredentials('clerk_abc');

    const policy = JSON.parse(send.mock.calls[0][0].input.Policy);
    const actions = policy.Statement.flatMap(
      (st: { Action: string | string[] }) =>
        Array.isArray(st.Action) ? st.Action : [st.Action],
    );
    expect(actions).toEqual(['rekognition:StartFaceLivenessSession']);
    // 🚨 THE ONE THAT MATTERS. A browser able to read its own liveness result
    // is a browser able to lie about it, and the gate becomes theatre.
    expect(actions).not.toContain('rekognition:GetFaceLivenessSessionResults');
    // Nor spend the Textract budget on whatever it likes.
    expect(actions.join(' ')).not.toMatch(/textract/i);
  });

  it('is region-locked the same way the server is', async () => {
    delete process.env[ROLE];
    const { svc, send } = serviceWithStubbedSts();

    await svc.vendBrowserCredentials('clerk_abc');

    const policy = JSON.parse(send.mock.calls[0][0].input.Policy);
    expect(
      policy.Statement[0].Condition.StringEquals['aws:RequestedRegion'],
    ).toBe('eu-west-1');
  });

  it('uses the tighter role path when one is configured', async () => {
    process.env[ROLE] =
      'arn:aws:iam::123456789012:role/alloutdoor-kyc-liveness-browser';
    const { svc, send } = serviceWithStubbedSts();

    await svc.vendBrowserCredentials('clerk_abc');

    expect(send.mock.calls[0][0].constructor.name).toBe('AssumeRoleCommand');
  });

  it('keeps the session name inside the 32-character limit', async () => {
    delete process.env[ROLE];
    const { svc, send } = serviceWithStubbedSts();

    // Clerk ids are long. GetFederationToken caps Name at 32 while AssumeRole
    // allows 64, so the shorter limit has to govern both paths — otherwise
    // switching to the role and back would start rejecting names.
    await svc.vendBrowserCredentials('user_2abcdefghijklmnopqrstuvwxyz0123456789');

    const name = send.mock.calls[0][0].input.Name;
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^[\w+=,.@-]+$/);
  });

  it('returns nothing at all when AWS is not configured', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const { svc, send } = serviceWithStubbedSts();

    // Undefined rather than a throw: the caller degrades to "no challenge
    // ran", which parks the seller for a human instead of failing them.
    await expect(
      svc.vendBrowserCredentials('clerk_abc'),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
