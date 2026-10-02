import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Database } from '@tuello/db';
import { CSRF_HEADER, DOMAIN_EVENTS } from '@tuello/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { DB } from './infra/tokens';

export function buildOpenApi(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Tuello API')
    .setDescription(
      [
        'Versioned REST API. The web app uses exactly this API.',
        '',
        'Requests are tenant-scoped by host name: `{slug}.tuello.app` or a verified custom domain.',
        `State-changing requests need the \`tuello_csrf\` cookie echoed in the \`${CSRF_HEADER}\` header.`,
        'Errors are RFC 9457 `application/problem+json`. Each operation lists the permission it needs in `x-permission`.',
        '',
        '**Domain events** (outbox):',
        ...Object.entries(DOMAIN_EVENTS).map(([k, v]) => `- \`${k}\`: ${v}`),
      ].join('\n'),
    )
    .setVersion('1')
    .addCookieAuth(
      'tuello_session',
      { type: 'apiKey', in: 'cookie', name: 'tuello_session' },
      'session',
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

export async function createApp(
  options: { logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: options.logger === false ? false : undefined,
  });
  const env = app.get<Env>(ENV);
  if (options.logger !== false) app.useLogger(app.get(Logger));

  app.set('trust proxy', env.TRUST_PROXY ? true : false);
  app.disable('x-powered-by');
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: undefined });
  app.enableShutdownHooks();

  const document = buildOpenApi(app);
  SwaggerModule.setup('v1/docs', app, document, { jsonDocumentUrl: 'v1/openapi.json' });

  // Refuse to start as a role that can bypass row-level security.
  await app.get<Database>(DB).system.assertRuntimeRoleIsRestricted();
  return app;
}
