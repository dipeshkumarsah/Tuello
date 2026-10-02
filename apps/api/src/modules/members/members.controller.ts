import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Database } from '@tuello/db';
import {
  assignableRoles,
  cursorPageQuerySchema,
  updateMemberSchema,
  type CursorPage,
  type CursorPageQuery,
  type MemberDto,
  type Role,
} from '@tuello/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { afterCursorAsc, decodeCursor, toPage } from '../../common/pagination';
import { Problem } from '../../common/problem';
import type { TuelloRequest } from '../../common/request';
import { ApiZodBody, ApiZodQuery, ZBody, ZQuery } from '../../common/zod';
import { DB } from '../../infra/tokens';
import { AuditService, EventsService } from '../events/events.service';
import { SessionService } from '../identity/session.service';

@ApiTags('members')
@Controller({ path: 'members', version: '1' })
export class MembersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequirePermission('members.read')
  @ApiZodQuery(cursorPageQuerySchema)
  async list(@ZQuery(cursorPageQuerySchema) q: CursorPageQuery): Promise<CursorPage<MemberDto>> {
    const rows = await this.db.tx.membership.findMany({
      where: { deletedAt: null, ...afterCursorAsc(decodeCursor(q.cursor)) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: { user: { select: { name: true, email: true, totpEnabledAt: true } } },
    });
    return toPage(rows, q.limit, (m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role as Role,
      status: m.status,
      twoFactorEnabled: !!m.user.totpEnabledAt,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  private async load(id: string) {
    const m = await this.db.tx.membership.findFirst({ where: { id, deletedAt: null } });
    if (!m) throw new Problem('not_found');
    return m;
  }

  private async assertOtherOwnerRemains(excludingId: string) {
    const owners = await this.db.tx.membership.count({
      where: { role: 'owner', deletedAt: null, status: 'active', NOT: { id: excludingId } },
    });
    if (owners === 0) throw new Problem('conflict', 'A company needs at least one owner.');
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  @ApiZodBody(updateMemberSchema)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZBody(updateMemberSchema) body: z.infer<typeof updateMemberSchema>,
    @Req() req: TuelloRequest,
  ) {
    const actor = req.auth!;
    const m = await this.load(id);
    if (m.id === actor.membershipId)
      throw new Problem('forbidden', 'You cannot change your own role.');
    const allowed = assignableRoles(actor.role);
    if (!allowed.includes(body.role) || !allowed.includes(m.role as Role))
      throw new Problem('forbidden');
    if (m.role === 'owner' && body.role !== 'owner') await this.assertOtherOwnerRemains(m.id);
    const updated = await this.db.tx.membership.update({
      where: { id },
      data: { role: body.role },
    });
    await this.events.emit(
      'member.role_changed',
      { type: 'membership', id },
      { from: m.role, to: body.role, userId: m.userId },
    );
    await this.audit.record(
      req,
      'member.role_changed',
      { type: 'membership', id },
      { from: m.role, to: body.role },
    );
    return { id: updated.id, role: updated.role };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('members.manage')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: TuelloRequest) {
    const actor = req.auth!;
    const m = await this.load(id);
    if (m.id === actor.membershipId) throw new Problem('forbidden', 'You cannot remove yourself.');
    if (!assignableRoles(actor.role).includes(m.role as Role)) throw new Problem('forbidden');
    if (m.role === 'owner') await this.assertOtherOwnerRemains(m.id);
    await this.db.tx.membership.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'disabled' },
    });
    await this.sessions.revoke({ userId: m.userId });
    await this.events.emit(
      'member.removed',
      { type: 'membership', id },
      { userId: m.userId, role: m.role },
    );
    await this.audit.record(req, 'member.removed', { type: 'membership', id }, { role: m.role });
  }
}
