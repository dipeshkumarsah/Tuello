import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import {
  startTestDatabase,
  startTestS3,
  TEST_S3,
  type TestDatabase,
} from '@tuello/db/dist/testing';

let db: TestDatabase;
let valkey: StartedTestContainer;
let mailpit: StartedTestContainer;
let s3: Awaited<ReturnType<typeof startTestS3>>;

export async function setup(project: TestProject) {
  [db, valkey, mailpit, s3] = await Promise.all([
    startTestDatabase(),
    new GenericContainer(process.env.VALKEY_TEST_IMAGE ?? 'valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start(),
    new GenericContainer(process.env.MAILPIT_TEST_IMAGE ?? 'axllent/mailpit:latest')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/livez', 8025))
      .start(),
    startTestS3(),
  ]);
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: TEST_S3.region,
    forcePathStyle: true,
    credentials: TEST_S3,
  });
  for (let i = 0; ; i++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: TEST_S3.bucket }));
      break;
    } catch (err) {
      if (i > 30) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  project.provide('appDbUrl', db.appUrl);
  project.provide('adminDbUrl', db.adminUrl);
  project.provide('valkeyUrl', `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);
  project.provide('smtpUrl', `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`);
  project.provide('mailpitUrl', `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);
  project.provide('s3Endpoint', s3.endpoint);
}

export async function teardown() {
  await Promise.all([db?.stop(), valkey?.stop(), mailpit?.stop(), s3?.stop()]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    appDbUrl: string;
    adminDbUrl: string;
    valkeyUrl: string;
    smtpUrl: string;
    mailpitUrl: string;
    s3Endpoint: string;
  }
}
