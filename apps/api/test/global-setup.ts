import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  startTestDatabase,
  startTestS3,
  TEST_S3,
  type TestDatabase,
} from '@tuello/db/dist/testing';

let db: TestDatabase;
let valkey: StartedTestContainer;
let s3: Awaited<ReturnType<typeof startTestS3>>;

/** One PostgreSQL, one Valkey and one S3 (SeaweedFS) container for the whole API integration run. */
export async function setup(project: TestProject) {
  [db, valkey, s3] = await Promise.all([
    startTestDatabase(),
    new GenericContainer(process.env.VALKEY_TEST_IMAGE ?? 'valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start(),
    startTestS3(),
  ]);
  await createBucket(s3.endpoint);
  project.provide('s3Endpoint', s3.endpoint);
  project.provide('appDbUrl', db.appUrl);
  project.provide('adminDbUrl', db.adminUrl);
  project.provide('valkeyUrl', `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);
}

export async function teardown() {
  await Promise.all([db?.stop(), valkey?.stop(), s3?.stop()]);
}

export async function createBucket(endpoint: string) {
  const client = new S3Client({
    endpoint,
    region: TEST_S3.region,
    forcePathStyle: true,
    credentials: TEST_S3,
  });
  for (let i = 0; i < 30; i++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: TEST_S3.bucket }));
      return;
    } catch (err) {
      if ((err as { name?: string }).name === 'BucketAlreadyOwnedByYou') return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('S3 test bucket could not be created');
}

declare module 'vitest' {
  export interface ProvidedContext {
    appDbUrl: string;
    adminDbUrl: string;
    valkeyUrl: string;
    s3Endpoint: string;
  }
}
