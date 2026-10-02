import './instrument';
import 'reflect-metadata';
import { createApp } from './bootstrap';
import { ENV, type Env } from './config/env';

async function main() {
  const app = await createApp();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void main();
