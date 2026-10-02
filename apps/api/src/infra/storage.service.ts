import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * S3-API object storage (R2 in production, MinIO locally). Keys are always prefixed with the
 * tenant ID. Buckets are private: reads and writes use short-lived signed URLs only.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  /** Signs URLs with the browser-reachable endpoint (differs from the in-cluster one locally). */
  private readonly publicClient: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.publicClient = new S3Client({
      ...base,
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
    });
  }

  static tenantKey(tenantId: string, ...parts: string[]): string {
    return [tenantId, ...parts].join('/');
  }

  static belongsTo(tenantId: string, key: string): boolean {
    return key.startsWith(`${tenantId}/`) && !key.includes('..');
  }

  async presignUpload(opts: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresIn?: number;
  }) {
    return createPresignedPost(this.publicClient, {
      Bucket: this.env.S3_BUCKET,
      Key: opts.key,
      Conditions: [
        ['content-length-range', 1, opts.maxBytes],
        ['eq', '$Content-Type', opts.contentType],
      ],
      Fields: { 'Content-Type': opts.contentType },
      Expires: opts.expiresIn ?? 300,
    });
  }

  async signedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      {
        expiresIn,
      },
    );
  }
}
