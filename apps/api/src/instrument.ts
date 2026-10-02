/**
 * Loaded first (node -r / top of main.ts). OpenTelemetry traces go to any OTLP collector when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; errors go to GlitchTip through the Sentry SDK when
 * SENTRY_DSN is set. Both are off by default.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import * as Sentry from '@sentry/node';

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'tuello-api';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.RELEASE,
    // Tracing is OpenTelemetry's job; Sentry/GlitchTip receives errors only.
    tracesSampleRate: 0,
    skipOpenTelemetrySetup: true,
    sendDefaultPii: false,
    // Never ship tokens, cookies or bodies to the error tracker.
    beforeSend(event) {
      if (event.request) {
        if (event.request.url)
          event.request.url = event.request.url
            .split('?')[0]!
            .replace(/\/token\/[^/]+/g, '/token/[redacted]');
        delete event.request.query_string;
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of ['cookie', 'authorization', 'x-csrf-token'])
            delete event.request.headers[h];
        }
      }
      return event;
    },
  });
}

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/healthz' || req.url === '/readyz',
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk.shutdown());
}
