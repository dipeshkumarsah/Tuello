import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { WorkerEnv } from '../config';

/** Signed, time-limited URLs only; buckets are private. */
export class Storage {
  private readonly client: S3Client;
  constructor(private readonly env: WorkerEnv) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  /** Long enough for an email to be opened within the week. */
  signedGetUrl(key: string, expiresIn = 7 * 24 * 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      { expiresIn },
    );
  }
}
