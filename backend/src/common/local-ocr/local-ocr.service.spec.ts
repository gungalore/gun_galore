import { LocalOcrService } from './local-ocr.service';

describe('LocalOcrService (PaddleOCR-VL)', () => {
  const previousUrl = process.env.PADDLE_OCR_URL;
  const previousEnabled = process.env.LOCAL_OCR_ENABLED;

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.PADDLE_OCR_URL;
    else process.env.PADDLE_OCR_URL = previousUrl;
    if (previousEnabled === undefined) delete process.env.LOCAL_OCR_ENABLED;
    else process.env.LOCAL_OCR_ENABLED = previousEnabled;
    jest.restoreAllMocks();
  });

  it('sends every crop in one batched request', async () => {
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8090/ocr';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        texts: ['C7276902', '2016-10-28', 'Handgun'],
      }),
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    const reads = await new LocalOcrService().readMany([
      Buffer.from('one'),
      Buffer.from('two'),
      Buffer.from('three'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).images).toHaveLength(3);
    expect(reads.map((read) => read?.text)).toEqual([
      'C7276902',
      '2016-10-28',
      'Handgun',
    ]);
  });

  it('returns nulls when the local service is down', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const reads = await new LocalOcrService().readMany([
      Buffer.from('one'),
      Buffer.from('two'),
    ]);

    expect(reads).toEqual([null, null]);
  });
});
