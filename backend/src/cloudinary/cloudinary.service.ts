import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  onModuleInit() {
    const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey     = process.env.CLOUDINARY_API_KEY;
    const apiSecret  = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      this.logger.warn('Cloudinary env vars not set — image upload disabled');
      return;
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this.configured = true;
    this.logger.log(`Cloudinary connected (cloud: ${cloudName})`);
  }

  async uploadImage(
    fileBuffer: Buffer,
    folder: string,
    publicId?: string,
  ): Promise<{ url: string; publicId: string }> {
    if (!this.configured) throw new Error('Cloudinary not configured');
    return new Promise((resolve, reject) => {
      const options: Record<string, unknown> = {
        folder: `gun-galore/${folder}`,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      };
      if (publicId) options.public_id = publicId;

      cloudinary.uploader
        .upload_stream(options, (error, result: UploadApiResponse | undefined) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        })
        .end(fileBuffer);
    });
  }

  // Upload a non-image file (e.g. a PDF) as a raw asset — stored
  // byte-for-byte with no image transformation, so the original
  // downloads/opens intact. Used for the dealer-stamped SAP 534 when the
  // seller uploads a PDF rather than a photo.
  async uploadRaw(
    fileBuffer: Buffer,
    folder: string,
    publicId?: string,
  ): Promise<{ url: string; publicId: string }> {
    if (!this.configured) throw new Error('Cloudinary not configured');
    return new Promise((resolve, reject) => {
      const options: Record<string, unknown> = {
        folder: `gun-galore/${folder}`,
        resource_type: 'raw',
      };
      if (publicId) options.public_id = publicId;

      cloudinary.uploader
        .upload_stream(options, (error, result: UploadApiResponse | undefined) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'));
          resolve({ url: result.secure_url, publicId: result.public_id });
        })
        .end(fileBuffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!this.configured) return;
    await cloudinary.uploader.destroy(publicId);
  }

  async deleteImages(publicIds: string[]): Promise<void> {
    if (!this.configured || publicIds.length === 0) return;
    await cloudinary.api.delete_resources(publicIds);
  }
}
