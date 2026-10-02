import { applyDecorators, Body, Query, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { createTranslator } from '@tuello/shared';
import { Problem } from './problem';

const t = createTranslator('en');

export class ZodPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new Problem(
      'validation_failed',
      undefined,
      result.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message.startsWith('validation.') ? t(i.message) : i.message,
      })),
    );
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** Validated body + OpenAPI request schema from the same Zod schema. */
export const ZBody = <T extends ZodType>(schema: T) => Body(new ZodPipe(schema));
export const ZQuery = <T extends ZodType>(schema: T) => Query(new ZodPipe(schema));

export const ApiZodBody = (schema: ZodType) =>
  applyDecorators(ApiBody({ schema: jsonSchema(schema) as never }));

export const ApiZodQuery = (schema: ZodType) => {
  const js = jsonSchema(schema) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  return applyDecorators(
    ...Object.entries(js.properties ?? {}).map(([name, s]) =>
      ApiQuery({ name, required: js.required?.includes(name) ?? false, schema: s as never }),
    ),
  );
};
