import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { startTestDatabase, type TestDatabase } from '@tuello/db/dist/testing';

let db: TestDatabase;
let valkey: StartedTestContainer;

/** One PostgreSQL and one Valkey container for the whole API integration run. */
export async function setup(project: TestProject) {
  [db, valkey] = await Promise.all([
    startTestDatabase(),
    new GenericContainer(process.env.VALKEY_TEST_IMAGE ?? 'valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start(),
  ]);
  project.provide('appDbUrl', db.appUrl);
  project.provide('adminDbUrl', db.adminUrl);
  project.provide('valkeyUrl', `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);
}

export async function teardown() {
  await Promise.all([db?.stop(), valkey?.stop()]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    appDbUrl: string;
    adminDbUrl: string;
    valkeyUrl: string;
  }
}
