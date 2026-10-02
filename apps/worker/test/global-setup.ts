import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { startTestDatabase, type TestDatabase } from '@tuello/db/dist/testing';

let db: TestDatabase;
let valkey: StartedTestContainer;
let mailpit: StartedTestContainer;

export async function setup(project: TestProject) {
  [db, valkey, mailpit] = await Promise.all([
    startTestDatabase(),
    new GenericContainer(process.env.VALKEY_TEST_IMAGE ?? 'valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start(),
    new GenericContainer(process.env.MAILPIT_TEST_IMAGE ?? 'axllent/mailpit:latest')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/livez', 8025))
      .start(),
  ]);
  project.provide('appDbUrl', db.appUrl);
  project.provide('adminDbUrl', db.adminUrl);
  project.provide('valkeyUrl', `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);
  project.provide('smtpUrl', `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`);
  project.provide('mailpitUrl', `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);
}

export async function teardown() {
  await Promise.all([db?.stop(), valkey?.stop(), mailpit?.stop()]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    appDbUrl: string;
    adminDbUrl: string;
    valkeyUrl: string;
    smtpUrl: string;
    mailpitUrl: string;
  }
}
