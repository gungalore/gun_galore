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

  /** True when Cloudinary credentials are present. Retention must not delete
   * DB media rows when the underlying assets cannot actually be destroyed. */
  isConfigured(): boolean {
    return this.configured;
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!this.configured) return;
    await cloudinary.uploader.destroy(publicId);
  }

  /**
   * Upload a video. Cloudinary stores it on the `video` resource type and
   * returns dimensions/duration. A poster frame is derived from the delivery
   * URL (`so_0` = first frame) so the feed can show a thumbnail without a
   * second upload.
   */
  async uploadVideo(
    fileBuffer: Buffer,
    folder: string,
    publicId?: string,
    access: 'public' | 'authenticated' = 'public',
  ): Promise<{
    url: string;
    publicId: string;
    thumbnailUrl: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
  }> {
    if (!this.configured) throw new Error('Cloudinary not configured');
    return new Promise((resolve, reject) => {
      const options: Record<string, unknown> = {
        folder: `gun-galore/${folder}`,
        resource_type: 'video',
      };
      if (access === 'authenticated') {
        options.type = 'authenticated';
        options.access_mode = 'authenticated';
      }
      if (publicId) options.public_id = publicId;

      cloudinary.uploader
        .upload_stream(options, (error, result: UploadApiResponse | undefined) => {
          if (error || !result) return reject(error ?? new Error('Upload failed'));
          const publicUrl = result.secure_url;
          const thumbnailUrl =
            access === 'authenticated'
              ? this.signedVideoUrl(result.public_id, true)
              : publicUrl
                  .replace('/video/upload/', '/video/upload/so_0/')
                  .replace(/\.\w+$/, '.jpg');
          resolve({
            url:
              access === 'authenticated'
                ? this.signedVideoUrl(result.public_id)
                : publicUrl,
            publicId: result.public_id,
            thumbnailUrl,
            durationSeconds: result.duration,
            width: result.width,
            height: result.height,
          });
        })
        .end(fileBuffer);
    });
  }

  /** Signed delivery URL for a private/authenticated video (or its poster). */
  signedVideoUrl(
    publicId: string,
    thumbnail = false,
    maxEdge?: number,
    keepAudio = true,
  ): string {
    const transformation = thumbnail
      ? [{ start_offset: '0' }]
      : maxEdge
        ? [
            {
              width: Math.max(1, Math.round(maxEdge)),
              crop: 'limit',
              quality: 'auto:eco',
              fetch_format: 'mp4',
              ...(keepAudio ? {} : { audio_codec: 'none' }),
            },
          ]
        : undefined;
    return cloudinary.url(publicId, {
      resource_type: 'video',
      type: 'authenticated',
      sign_url: true,
      secure: true,
      ...(transformation ? { transformation } : {}),
      ...(thumbnail ? { format: 'jpg' } : {}),
    });
  }

  /**
   * Turn a pending authenticated clip into a normal public marketplace asset.
   * Cloudinary cannot freely change delivery type, so download the signed
   * original and re-upload it public. Callers then delete/replace the private
   * asset and store the returned public row.
   */
  async publishPrivateVideo(publicId: string): Promise<{
    url: string;
    publicId: string;
    thumbnailUrl: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
  }> {
    const signed = this.signedVideoUrl(publicId);
    const res = await fetch(signed);
    if (!res.ok) {
      throw new Error(`Could not read pending video (${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return this.uploadVideo(buffer, 'listings');
  }

  async deleteVideo(
    publicId: string,
    access: 'public' | 'authenticated' = 'public',
  ): Promise<void> {
    if (!this.configured) return;
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      ...(access === 'authenticated' ? { type: 'authenticated' } : {}),
    });
  }

  async deleteImages(publicIds: string[]): Promise<void> {
    if (!this.configured || publicIds.length === 0) return;
    await cloudinary.api.delete_resources(publicIds);
  }
}
