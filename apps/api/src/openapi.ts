/** Writes the OpenAPI document generated from code: `pnpm --filter @tuello/api openapi > openapi.json`. */
import 'reflect-metadata';
import { createApp, buildOpenApi } from './bootstrap';

async function main() {
  const app = await createApp({ logger: false });
  process.stdout.write(JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
}

void main();
