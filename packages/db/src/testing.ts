import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * Test-only helper (imported as '@tuello/db/dist/testing'; never from runtime code).
 * Starts PostgreSQL 16 in a container, creates the runtime role, and applies the real
 * migrations with `prisma migrate deploy`. Reused by api integration tests.
 */
export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Superuser URL (migrations, fixtures that need it). */
  adminUrl: string;
  /** Runtime URL as tuello_app (subject to RLS). */
  appUrl: string;
  stop(): Promise<void>;
}

export const APP_DB_PASSWORD = 'tuello_app_test_password';

export async function startTestDatabase(): Promise<TestDatabase> {
  const image = process.env.PG_TEST_IMAGE ?? 'postgres:16-alpine';
  const container = await new PostgreSqlContainer(image)
    .withDatabase('tuello')
    .withUsername('tuello')
    .withPassword('tuello')
    .start();
  const adminUrl = container.getConnectionUri();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    `CREATE ROLE tuello_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS`,
  );
  await admin.end();

  const prismaBin = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: adminUrl, DIRECT_DATABASE_URL: adminUrl },
    stdio: 'pipe',
  });

  const u = new URL(adminUrl);
  u.username = 'tuello_app';
  u.password = APP_DB_PASSWORD;
  return {
    container,
    adminUrl,
    appUrl: u.toString(),
    stop: async () => {
      await container.stop();
    },
  };
}

export const TEST_S3 = {
  accessKeyId: 'tuello',
  secretAccessKey: 'tuello-dev-secret',
  bucket: 'tuello',
  region: 'us-east-1',
};

/**
 * S3-compatible object storage for tests (SeaweedFS, Apache-2.0). Supports presigned POST, so
 * tests exercise the same browser-upload path as production. Create the bucket with your SDK.
 */
export async function startTestS3(): Promise<{ endpoint: string; stop(): Promise<void> }> {
  const { GenericContainer, Wait } = await import('testcontainers');
  const config = JSON.stringify({
    identities: [
      {
        name: 'tuello',
        credentials: [{ accessKey: TEST_S3.accessKeyId, secretKey: TEST_S3.secretAccessKey }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  });
  const container = await new GenericContainer(
    process.env.S3_TEST_IMAGE ?? 'chrislusf/seaweedfs:latest',
  )
    .withCopyContentToContainer([{ content: config, target: '/etc/sw/s3.json' }])
    .withCommand([
      'server',
      '-s3',
      '-s3.config=/etc/sw/s3.json',
      '-dir=/data',
      '-ip.bind=0.0.0.0',
      '-master.volumeSizeLimitMB=64',
    ])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
