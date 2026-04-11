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

  createUploadSignature(params: {
    timestamp: number;
    folder: string;
    publicId?: string;
  }) {
    const signingParams: Record<string, string | number> = {
      timestamp: params.timestamp,
      folder: params.folder,
    };

    if (params.publicId) {
      signingParams.public_id = params.publicId;
    }

    const signature = cloudinary.utils.api_sign_request(
      signingParams,
      this.apiSecret,
    );

    return {
      signature,
      timestamp: params.timestamp,
      folder: params.folder,
      apiKey: this.apiKey,
      cloudName: this.cloudName,
      resourceType: 'auto' as const,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`,
    };
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
}
