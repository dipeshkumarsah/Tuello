import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { WorkerEnv } from '../config';

/** Signed, time-limited URLs only; buckets are private. Keys are always tenant-prefixed. */
export class Storage {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  constructor(private readonly env: WorkerEnv) {
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

  /** Long enough for an email to be opened within the week. */
  signedGetUrl(key: string, expiresIn = 7 * 24 * 3600): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      { expiresIn },
    );
  }

  async stream(key: string): Promise<Readable> {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
    );
    return r.Body as Readable;
  }

  async put(key: string, body: string | Buffer, contentType = 'text/csv'): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Streams a body of unknown length (multipart under the hood). */
  async upload(key: string, body: Readable, contentType = 'text/csv'): Promise<void> {
    await new Upload({
      client: this.client,
      params: { Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType },
    }).done();
  }
}
