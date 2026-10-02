import { Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, uuidv7, type Database, type ImportJob } from '@tuello/db';
import {
  createImportSchema,
  cursorPageQuerySchema,
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  importMappingSchema,
  parseImportRow,
  startImportSchema,
  suggestMapping,
  type CursorPage,
  type ImportEntity,
  type ImportJobDto,
  type ImportMapping,
  type ImportPreviewDto,
} from '@tuello/shared';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { RateLimit, RequirePermission } from '../../common/decorators';
import { afterCursorDesc, decodeCursor, toPage } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { QueueService } from '../../infra/queue.service';
import { StorageService } from '../../infra/storage.service';
import { DB } from '../../infra/tokens';
import { EventsService } from '../events/events.service';

const PREVIEW_BYTES = 256 * 1024;
const previewSchema = z.object({ mapping: importMappingSchema.optional() });

export function toImportDto(j: ImportJob): ImportJobDto {
  return {
    id: j.id,
    entity: j.entity,
    status: j.status,
    fileName: j.fileName,
    mapping: (j.mapping as ImportMapping | null) ?? null,
    totalRows: j.totalRows,
    processedRows: j.processedRows,
    createdCount: j.createdCount,
    updatedCount: j.updatedCount,
    errorCount: j.errorCount,
    hasErrorReport: !!j.errorReportKey,
    lastError: j.lastError,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

/** Parses the beginning of a CSV (up to the last complete line). */
export function parseCsvHead(
  text: string,
  complete: boolean,
): { headers: string[]; rows: Array<Record<string, string>> } {
  const body = complete ? text : text.slice(0, Math.max(0, text.lastIndexOf('\n')));
  const records = parse(body.replace(/^\uFEFF/, ''), {
    relax_column_count: true,
    skip_empty_lines: true,
    skip_records_with_empty_values: true,
    bom: true,
  }) as string[][];
  const [header = [], ...data] = records;
  const headers = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  return {
    headers,
    rows: data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
  };
}

/**
 * CSV import for clients and brokerages:
 *   1. POST /imports            -> job + presigned upload (browser uploads straight to storage)
 *   2. POST /imports/:id/preview -> headers, suggested mapping, first rows validated
 *   3. POST /imports/:id/start   -> background job (worker) with the confirmed mapping
 *   4. GET  /imports/:id         -> progress; error report download when done
 * Imports are idempotent: rows upsert on external ID, then email, then name + phone.
 */
@ApiTags('imports')
@Controller({ path: 'imports', version: '1' })
export class ImportsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly events: EventsService,
  ) {}

  private async load(id: string) {
    const j = await this.db.tx.importJob.findFirst({ where: { id } });
    if (!j) throw new Problem('not_found');
    return j;
  }

  @Get()
  @RequirePermission('clients.manage')
  @ApiZodQuery(cursorPageQuerySchema)
  async list(
    @ZQuery(cursorPageQuerySchema) q: z.infer<typeof cursorPageQuerySchema>,
  ): Promise<CursorPage<ImportJobDto>> {
    const rows = await this.db.tx.importJob.findMany({
      where: afterCursorDesc(decodeCursor(q.cursor)),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return toPage(rows, q.limit, toImportDto);
  }

  @Post()
  @RequirePermission('clients.manage')
  @RateLimit({ by: 'tenant', limit: 60, windowSec: 3600 })
  @ApiZodBody(createImportSchema)
  async create(
    @ZBody(createImportSchema) body: z.infer<typeof createImportSchema>,
    @Req() req: TuelloRequest,
  ) {
    const tenantId = req.tenant!.id;
    const id = uuidv7();
    const fileKey = StorageService.tenantKey(tenantId, 'imports', `${id}.csv`);
    const job = await this.db.tx.importJob.create({
      data: {
        id,
        tenantId,
        entity: body.entity,
        fileKey,
        fileName: body.fileName,
        fileSize: body.size,
        createdByUserId: req.auth!.userId,
      },
    });
    const upload = await this.storage.presignUpload({
      key: fileKey,
      contentType: 'text/csv',
      maxBytes: IMPORT_MAX_BYTES,
      expiresIn: 900,
    });
    return { import: toImportDto(job), upload: { url: upload.url, fields: upload.fields } };
  }

  @Get(':id')
  @RequirePermission('clients.manage')
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ImportJobDto> {
    return toImportDto(await this.load(id));
  }

  @Post(':id/preview')
  @HttpCode(200)
  @RequirePermission('clients.manage')
  @ApiZodBody(previewSchema)
  async preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(previewSchema) body: z.infer<typeof previewSchema>,
  ): Promise<ImportPreviewDto> {
    const job = await this.load(id);
    const size = await this.storage.head(job.fileKey);
    if (size == null) throw new Problem('validation_failed', 'The file has not been uploaded yet.');
    if (job.status === 'awaiting_upload')
      await this.db.tx.importJob.update({
        where: { id },
        data: { status: 'uploaded', fileSize: size },
      });
    let parsed: ReturnType<typeof parseCsvHead>;
    try {
      parsed = parseCsvHead(
        await this.storage.readHead(job.fileKey, PREVIEW_BYTES),
        size <= PREVIEW_BYTES,
      );
    } catch (err) {
      throw new Problem(
        'validation_failed',
        `This file is not a readable CSV: ${(err as Error).message.slice(0, 200)}`,
      );
    }
    if (!parsed.headers.length) throw new Problem('validation_failed', 'The file is empty.');
    const entity = job.entity as ImportEntity;
    const suggested = suggestMapping(entity, parsed.headers);
    const mapping = body.mapping ?? suggested;
    return {
      headers: parsed.headers,
      suggestedMapping: suggested,
      fields: IMPORT_FIELDS[entity],
      rows: parsed.rows.slice(0, 20).map((raw, i) => {
        const r =
          entity === 'clients'
            ? parseImportRow('clients', raw, mapping)
            : parseImportRow('brokerages', raw, mapping);
        return { line: i + 2, raw, ok: r.ok, errors: r.ok ? [] : r.errors };
      }),
    };
  }

  @Post(':id/start')
  @HttpCode(202)
  @RequirePermission('clients.manage')
  @ApiZodBody(startImportSchema)
  async start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(startImportSchema) body: z.infer<typeof startImportSchema>,
    @Req() req: TuelloRequest,
  ): Promise<ImportJobDto> {
    const job = await this.load(id);
    if (!['awaiting_upload', 'uploaded', 'failed'].includes(job.status))
      throw new Problem('conflict', 'This import has already started.');
    if ((await this.storage.head(job.fileKey)) == null)
      throw new Problem('validation_failed', 'The file has not been uploaded yet.');
    const fields = IMPORT_FIELDS[job.entity as ImportEntity];
    const known = new Set(fields.map((f) => f.key));
    const unknown = Object.keys(body.mapping).filter((k) => !known.has(k));
    if (unknown.length)
      throw new Problem('validation_failed', `Unknown fields: ${unknown.join(', ')}`);
    const missing = fields.filter((f) => f.required && !body.mapping[f.key]);
    if (missing.length)
      throw new Problem(
        'validation_failed',
        `Map a column to: ${missing.map((f) => f.label).join(', ')}`,
      );
    if (
      job.entity === 'clients' &&
      !['email', 'externalRef', 'phone'].some((k) => body.mapping[k])
    ) {
      throw new Problem(
        'validation_failed',
        'Map an email, external ID or phone column so the import can recognise existing clients.',
      );
    }
    const updated = await this.db.tx.importJob.update({
      where: { id },
      data: { status: 'queued', mapping: body.mapping as Prisma.InputJsonValue, lastError: null },
    });
    this.queue.enqueueImport({ tenantId: req.tenant!.id, importId: id, userId: req.auth!.userId });
    await this.events.emit(
      'import.started',
      { type: 'import', id },
      { entity: job.entity, fileName: job.fileName },
    );
    return toImportDto(updated);
  }

  @Get(':id/error-report')
  @RequirePermission('clients.manage')
  async errorReport(@Param('id', new ParseUUIDPipe()) id: string) {
    const job = await this.load(id);
    if (!job.errorReportKey) throw new Problem('not_found');
    return {
      url: await this.storage.signedGetUrl(
        job.errorReportKey,
        600,
        `${job.fileName.replace(/\.csv$/i, '')}-errors.csv`,
      ),
    };
  }
}
