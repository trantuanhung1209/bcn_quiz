import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import type { Express } from 'express';
import 'multer';

export type UploadedCloudinaryFile = {
  secureUrl: string;
  publicId: string;
  resourceType: string;
  bytes: number;
  format: string;
};

export type CloudinaryUploadSignature = {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  resourceType: 'auto';
  uploadUrl: string;
  /** Present when upload must convert/store as this format (e.g. webp). FE must send the same field. */
  format?: string;
  /** Optional Cloudinary quality hint (e.g. auto). FE must send when present. */
  quality?: string;
  /** Soft limit for FE pre-check (bytes). Backend also enforces on save. */
  maxBytes?: number;
  /** Convenience for FE UI copy (e.g. 3). */
  maxFileSizeMb?: number;
};

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }

    this.cloudName = cloudName;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;

    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      secure: true,
    });
  }

  getCloudinaryConfig() {
    return {
      cloudName: this.cloudName,
      apiKey: this.apiKey,
    };
  }

  /**
   * Default image optimization for quiz/topic/course covers.
   * Empty CLOUDINARY_IMAGE_FORMAT disables conversion.
   */
  getImageOptimizationDefaults(): { format?: string; quality?: string } {
    const format = (process.env.CLOUDINARY_IMAGE_FORMAT ?? 'webp')
      .trim()
      .toLowerCase();
    const quality = (process.env.CLOUDINARY_IMAGE_QUALITY ?? 'auto')
      .trim()
      .toLowerCase();

    return {
      ...(format ? { format } : {}),
      ...(quality ? { quality } : {}),
    };
  }

  /** Max image size for quiz/topic/course (default 3MB). */
  getImageMaxBytes(): number {
    const fromEnv = Number(process.env.CLOUDINARY_IMAGE_MAX_BYTES);
    if (Number.isFinite(fromEnv) && fromEnv > 0) {
      return Math.floor(fromEnv);
    }
    return 3 * 1024 * 1024;
  }

  createUploadSignature(params: {
    timestamp: number;
    folder: string;
    publicId?: string;
    format?: string;
    quality?: string;
    /** Include maxBytes in response for image uploads (not signed). */
    includeMaxBytes?: boolean;
  }): CloudinaryUploadSignature {
    const signingParams: Record<string, string | number> = {
      timestamp: params.timestamp,
      folder: params.folder,
    };

    if (params.publicId) {
      signingParams.public_id = params.publicId;
    }

    const format = params.format?.trim().toLowerCase();
    if (format) {
      signingParams.format = format;
    }

    const quality = params.quality?.trim();
    if (quality) {
      signingParams.quality = quality;
    }

    const signature = cloudinary.utils.api_sign_request(
      signingParams,
      this.apiSecret,
    );

    const maxBytes = params.includeMaxBytes
      ? this.getImageMaxBytes()
      : undefined;

    return {
      signature,
      timestamp: params.timestamp,
      folder: params.folder,
      apiKey: this.apiKey,
      cloudName: this.cloudName,
      resourceType: 'auto' as const,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`,
      ...(format ? { format } : {}),
      ...(quality ? { quality } : {}),
      ...(maxBytes
        ? {
            maxBytes,
            maxFileSizeMb: Number((maxBytes / (1024 * 1024)).toFixed(2)),
          }
        : {}),
    };
  }

  /**
   * Enforce max size after direct Cloudinary upload.
   * Deletes the asset when over limit so oversized files are not left behind.
   */
  async assertImageWithinMaxBytes(publicId: string): Promise<void> {
    const maxBytes = this.getImageMaxBytes();
    const trimmed = publicId?.trim();
    if (!trimmed) {
      return;
    }

    let bytes: number | undefined;
    try {
      const resource = await cloudinary.api.resource(trimmed, {
        resource_type: 'image',
      });
      bytes = Number(resource?.bytes);
    } catch (error: any) {
      // Retry as raw/auto in case resource_type differs after upload.
      try {
        const resource = await cloudinary.api.resource(trimmed, {
          resource_type: 'raw',
        });
        bytes = Number(resource?.bytes);
      } catch {
        this.logger.warn(
          `Unable to read Cloudinary resource size for '${trimmed}': ${error?.message ?? error}`,
        );
        throw new BadRequestException(
          'Unable to verify uploaded image size. Please re-upload the image.',
        );
      }
    }

    if (!Number.isFinite(bytes) || bytes < 1) {
      throw new BadRequestException(
        'Unable to verify uploaded image size. Please re-upload the image.',
      );
    }

    if (bytes > maxBytes) {
      await this.deleteImage(trimmed);
      const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
      throw new BadRequestException(
        `Image exceeds the maximum size of ${maxMb}MB`,
      );
    }
  }

  async uploadRawFile(
    file: Express.Multer.File,
    folder: string,
    publicId: string,
  ): Promise<UploadedCloudinaryFile> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty or invalid');
    }

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'auto',
            folder,
            public_id: publicId,
            use_filename: false,
            unique_filename: false,
            overwrite: true,
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(error ?? new Error('Cloudinary upload failed'));
              return;
            }
            resolve(uploadResult);
          },
        );

        stream.end(file.buffer);
      });

      return {
        secureUrl: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        bytes: result.bytes,
        format: result.format ?? '',
      };
    } catch (error: any) {
      const reason =
        error?.message || error?.error?.message || 'Unknown Cloudinary error';
      this.logger.error(`Cloudinary upload failed: ${reason}`);
      throw new InternalServerErrorException(
        `Unable to upload file to Cloudinary: ${reason}`,
      );
    }
  }

  async deleteRawFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
    } catch {
      // Best effort cleanup only.
    }
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch {
      // Best effort cleanup only.
    }
  }
}
