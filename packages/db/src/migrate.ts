/**
 * Applies pending migrations with the Prisma CLI that ships in this package, so production images
 * can run them as a pre-deploy step without a separate toolchain:
 *
 *   DIRECT_DATABASE_URL=postgresql://owner@db/tuello node node_modules/@tuello/db/dist/migrate.js
 *
 * Uses the owner role (DIRECT_DATABASE_URL), never the RLS-restricted runtime role.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error('DIRECT_DATABASE_URL is required (owner role, direct connection, not PgBouncer)');
  process.exit(1);
}
const cli = require.resolve('prisma/build/index.js');
const schema = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? url, DIRECT_DATABASE_URL: url },
});
process.exit(result.status ?? 1);
