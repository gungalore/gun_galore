import { ServiceUnavailableException } from '@nestjs/common';

/**
 * The Cloudinary SDK is mocked: these tests are about OUR wrapper's contract —
 * a hung provider must fail fast as a retriable 503, and every upload must log
 * its size and duration instead of leaving a request silent for 95 s.
 */
const uploadStreamMock = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (...args: unknown[]) => uploadStreamMock(...args),
    },
  },
}));

import { CloudinaryService } from './cloudinary.service';

type Callback = (
  error: unknown,
  result?: { secure_url: string; public_id: string },
) => void;

function mockStream(
  run: (options: Record<string, unknown>, callback: Callback) => void,
): void {
  uploadStreamMock.mockImplementation(
    (options: Record<string, unknown>, callback: Callback) => ({
      end: () => run(options, callback),
    }),
  );
}

describe('CloudinaryService image uploads', () => {
  let service: CloudinaryService;

  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
  });

  beforeEach(() => {
    uploadStreamMock.mockReset();
    service = new CloudinaryService();
    service.onModuleInit();
  });

  it('passes a hard upload timeout and resolves the stored url', async () => {
    mockStream((options, callback) => {
      expect(options.folder).toBe('gun-galore/listings');
      expect(options.resource_type).toBe('image');
      expect(typeof options.timeout).toBe('number');
      expect(options.timeout as number).toBeGreaterThan(0);
      expect(options.timeout as number).toBeLessThan(95_000);
      callback(null, {
        secure_url: 'https://res.cloudinary.com/test/image/upload/abc.jpg',
        public_id: 'gun-galore/listings/abc',
      });
    });

    await expect(
      service.uploadImage(Buffer.from('jpeg-bytes'), 'listings'),
    ).resolves.toEqual({
      url: 'https://res.cloudinary.com/test/image/upload/abc.jpg',
      publicId: 'gun-galore/listings/abc',
    });
  });

  it('turns a provider timeout into a retriable 503, not a hanging request', async () => {
    mockStream((_options, callback) => {
      callback({ name: 'TimeoutError', http_code: 499 });
    });

    const attempt = service.uploadImage(Buffer.from('jpeg-bytes'), 'listings');

    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(attempt).rejects.toMatchObject({
      message: expect.stringContaining('taking too long'),
    });
  });

  it('keeps other provider failures as plain errors', async () => {
    mockStream((_options, callback) => {
      callback({ message: 'Invalid Signature' });
    });

    await expect(
      service.uploadImage(Buffer.from('jpeg-bytes'), 'listings'),
    ).rejects.not.toBeInstanceOf(ServiceUnavailableException);
  });
});
