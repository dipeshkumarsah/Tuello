import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
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
