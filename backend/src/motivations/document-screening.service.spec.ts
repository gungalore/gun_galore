import { DocumentScreeningService } from './document-screening.service';

function build(opts: {
  text?: string;
  throwCode?: string;
  pages?: Array<{ page: number; bytes: Buffer }>;
  key?: boolean;
}) {
  if (opts.key === false) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = 'test';

  const create = jest.fn(async (_args: unknown) => ({}));
  const prisma = {
    contactDetailRejection: { create },
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
  };
  const complete = jest.fn(async () => {
    if (opts.throwCode) {
      const e = new Error('boom') as Error & { code?: string };
      e.code = opts.throwCode;
      throw e;
    }
    return { text: opts.text ?? '' };
  });
  const pagesFor = jest.fn(async () => opts.pages ?? []);
  const svc = new DocumentScreeningService(
    prisma as never,
    { complete } as never,
    { pagesFor } as never,
  );
  return { svc, create, complete, pagesFor };
}

const input = {
  bytes: Buffer.from('page'),
  mimeType: 'image/jpeg',
  sha256: 'abc',
  ownerId: 'u1',
  label: 'My licence',
};

const prev = process.env.DEEPSEEK_API_KEY;
afterAll(() => {
  if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = prev;
});

describe('DocumentScreeningService', () => {
  it('does nothing without a DeepSeek key', async () => {
    const { svc, complete } = build({ key: false });
    await svc.screen(input);
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips a non-image, non-PDF mime', async () => {
    const { svc, complete } = build({ text: '{}' });
    await svc.screen({ ...input, mimeType: 'text/plain' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('records a flagged finding in the T&S queue', async () => {
    const { svc, create } = build({
      text: '{"flagged":true,"unsure":false,"categories":["advertising"],"reasons":["flyer not a licence"]}',
    });
    await svc.screen(input);
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.channel).toBe('vault-document');
    expect(arg.data.category).toBe('advertising');
  });

  it('records an unsure finding as a review row', async () => {
    const { svc, create } = build({
      text: '{"flagged":false,"unsure":true,"categories":[],"reasons":[]}',
    });
    await svc.screen(input);
    const arg = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(String(arg.data.category)).toContain('review:');
  });

  it('does not record a clean page', async () => {
    const { svc, create } = build({
      text: '{"flagged":false,"unsure":false,"categories":[],"reasons":[]}',
    });
    await svc.screen(input);
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores an unparseable reply', async () => {
    const { svc, create } = build({ text: 'not json' });
    await svc.screen(input);
    expect(create).not.toHaveBeenCalled();
  });

  it('rasterises a PDF at print scale and screens its pages', async () => {
    const { svc, pagesFor, complete } = build({
      text: '{"flagged":false,"unsure":false,"categories":[],"reasons":[]}',
      pages: [
        { page: 1, bytes: Buffer.from('a') },
        { page: 2, bytes: Buffer.from('b') },
      ],
    });
    await svc.screen({ ...input, mimeType: 'application/pdf' });
    expect(pagesFor).toHaveBeenCalledWith({
      bytes: input.bytes,
      sha256: input.sha256,
      render: 'print',
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('swallows a model error', async () => {
    const { svc, create } = build({ throwCode: 'timeout' });
    await expect(svc.screen(input)).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
