import { DocumentCaptureService } from './document-capture.service';
import { CAPTURE_VERSION } from './document-capture';

function llmWith(text: string) {
  const complete = jest.fn(async () => ({ text }));
  return { isConfigured: () => true, complete } as never;
}

describe('DocumentCaptureService', () => {
  it('returns the page text and every labelled fact', async () => {
    const svc = new DocumentCaptureService(
      llmWith(
        JSON.stringify({
          pageText: 'SA HUNTERS\nMembership No 108828\nDedicated since 2024-06-07',
          document: { family: 'membership certificate', issuer: 'SA Hunters' },
          facts: [
            {
              label: 'Membership No',
              value: '108828',
              valueType: 'reference',
              confidence: 'high',
            },
            {
              label: 'Dedicated since',
              value: '2024-06-07',
              valueType: 'date',
              confidence: 'high',
            },
          ],
          quality: { readable: true, notes: [] },
        }),
      ),
    );
    const out = await svc.capture({
      bytes: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });
    expect(out).not.toBeNull();
    expect(out!.version).toBe(CAPTURE_VERSION);
    expect(out!.pageText).toContain('SA HUNTERS');
    expect(out!.facts).toHaveLength(2);
    expect(out!.facts[1]).toMatchObject({
      label: 'Dedicated since',
      value: '2024-06-07',
      valueType: 'date',
    });
    expect(out!.document.family).toBe('membership certificate');
  });

  it('keeps a photograph with no text', async () => {
    const svc = new DocumentCaptureService(
      llmWith(
        JSON.stringify({
          pageText: '',
          document: { visualDescription: 'a reloading bench with a press' },
          facts: [],
          quality: { readable: true, notes: [] },
        }),
      ),
    );
    const out = await svc.capture({
      bytes: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });
    expect(out!.pageText).toBe('');
    expect(out!.document.visualDescription).toContain('reloading bench');
  });

  it('returns null when the provider is not configured', async () => {
    const svc = new DocumentCaptureService({
      isConfigured: () => false,
    } as never);
    expect(
      await svc.capture({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }),
    ).toBeNull();
  });

  it('returns null for unparseable output', async () => {
    const svc = new DocumentCaptureService(llmWith('not json at all'));
    expect(
      await svc.capture({ bytes: Buffer.from('x'), mimeType: 'image/jpeg' }),
    ).toBeNull();
  });
});
