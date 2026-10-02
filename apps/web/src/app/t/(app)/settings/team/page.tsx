'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignableRoles,
  emailSchema,
  ROLES,
  type CursorPage,
  type InviteDto,
  type MemberDto,
  type Role,
} from '@tuello/shared';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  Status,
  toast,
  type ColumnDef,
} from '@tuello/ui';
import { UserPlus, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { QueryError, RequirePermission } from '@/components/page';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCan, useMe } from '@/lib/session';

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const roles = assignableRoles(me.membership.role);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('coordinator');
  const [error, setError] = React.useState<string | undefined>();
  const invite = useMutation({
    mutationFn: () => post<InviteDto>('/v1/invites', { email, role }),
    onSuccess: (inv) => {
      toast({ title: t('team.inviteSent', { email: inv.email }), tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['invites'] });
      setEmail('');
      onOpenChange(false);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogTitle>{t('team.inviteTitle')}</DialogTitle>
        <DialogDescription>{t('team.empty.body')}</DialogDescription>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!emailSchema.safeParse(email).success) return setError(t('validation.email'));
            setError(undefined);
            invite.mutate();
          }}
        >
          <Field label={t('team.email')} error={error}>
            {(ids) => (
              <Input
                {...ids}
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('team.role')}>
            {(ids) => (
              <Select
                {...ids}
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))}
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="submit" loading={invite.isPending}>
              {t('team.invite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Team() {
  const { t, dateTime } = useI18n();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const canManage = useCan('members.manage');
  const canInvite = useCan('invites.manage');
  const [inviteOpen, setInviteOpen] = React.useState(params.get('invite') === '1' && canInvite);
  const [removing, setRemoving] = React.useState<MemberDto | null>(null);

  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => get<CursorPage<MemberDto>>('/v1/members?limit=100'),
  });
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => get<CursorPage<InviteDto>>('/v1/invites?limit=100'),
    enabled: useCan('invites.read'),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => patch(`/v1/members/${id}`, { role }),
    onMutate: async ({ id, role }) => {
      // Optimistic: the row updates immediately; rolled back on error.
      await qc.cancelQueries({ queryKey: ['members'] });
      const prev = qc.getQueryData<CursorPage<MemberDto>>(['members']);
      qc.setQueryData<CursorPage<MemberDto>>(
        ['members'],
        (d) => d && { ...d, items: d.items.map((m) => (m.id === id ? { ...m, role } : m)) },
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      qc.setQueryData(['members'], ctx?.prev);
      toast({
        title: err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err),
        tone: 'error',
      });
    },
    onSuccess: () => toast({ title: t('settings.saved'), tone: 'success' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/v1/members/${id}`),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) =>
      toast({
        title: err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : String(err),
        tone: 'error',
      }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/v1/invites/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
  });

  const assignable = assignableRoles(me.membership.role);
  const columns: ColumnDef<MemberDto, unknown>[] = [
    {
      accessorKey: 'name',
      header: t('profile.name'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {row.original.name}{' '}
            {row.original.userId === me.user.id ? (
              <span className="text-fg-muted">({t('team.you')})</span>
            ) : null}
          </span>
          <span className="text-sm text-fg-muted">{row.original.email}</span>
        </div>
      ),
      filterFn: (row, _id, q: string) =>
        `${row.original.name} ${row.original.email}`.toLowerCase().includes(q.toLowerCase()),
    },
    {
      accessorKey: 'role',
      header: t('team.role'),
      cell: ({ row }) => {
        const m = row.original;
        const editable = canManage && m.userId !== me.user.id && assignable.includes(m.role);
        return editable ? (
          <Select
            aria-label={`${t('team.role')}: ${m.name}`}
            value={m.role}
            onValueChange={(role) => changeRole.mutate({ id: m.id, role: role as Role })}
            options={assignable.map((r) => ({ value: r, label: t(`role.${r}`) }))}
            className="h-8 w-44 text-sm"
          />
        ) : (
          t(`role.${m.role}`)
        );
      },
      sortingFn: (a, b) => ROLES.indexOf(a.original.role) - ROLES.indexOf(b.original.role),
    },
    {
      id: 'security',
      header: t('team.twoFactor'),
      cell: ({ row }) =>
        row.original.twoFactorEnabled ? <Badge>{t('team.twoFactor')}</Badge> : null,
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: t('team.joined'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {dateTime(row.original.createdAt, { dateStyle: 'medium' })}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: '',
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }: { row: { original: MemberDto } }) =>
              row.original.userId !== me.user.id && assignable.includes(row.original.role) ? (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(row.original)}>
                  {t('common.remove')}
                </Button>
              ) : null,
          } satisfies ColumnDef<MemberDto, unknown>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader
          title={t('team.members')}
          action={
            canInvite ? (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus size={16} strokeWidth={1.5} aria-hidden /> {t('team.invite')}
              </Button>
            ) : undefined
          }
        />
        <div className="p-5">
          {members.isPending ? (
            <SkeletonRows rows={4} label={t('common.loading')} />
          ) : members.isError ? (
            <QueryError onRetry={() => void members.refetch()} />
          ) : members.data.items.length <= 1 && canInvite ? (
            <>
              <DataTable
                caption={t('team.members')}
                columns={columns}
                data={members.data.items}
                getRowId={(r) => r.id}
                filterPlaceholder={t('common.search')}
              />
              <EmptyState
                className="mt-4"
                icon={Users}
                title={t('team.empty.title')}
                body={t('team.empty.body')}
                action={<Button onClick={() => setInviteOpen(true)}>{t('team.invite')}</Button>}
              />
            </>
          ) : (
            <DataTable
              caption={t('team.members')}
              columns={columns}
              data={members.data.items}
              getRowId={(r) => r.id}
              filterPlaceholder={t('common.search')}
            />
          )}
        </div>
      </Card>

      {invites.data || invites.isPending ? (
        <Card>
          <CardHeader title={t('team.pendingInvites')} />
          <div className="p-5">
            {invites.isPending ? (
              <SkeletonRows rows={2} label={t('common.loading')} />
            ) : invites.data!.items.length === 0 ? (
              <p className="text-base text-fg-muted">{t('team.invitesEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {invites.data!.items.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{inv.email}</span>
                      <span className="text-sm text-fg-muted">{t(`role.${inv.role}`)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Status fill="outline" label={t('domains.status.pending')} />
                      {canInvite ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={revoke.isPending && revoke.variables === inv.id}
                          onClick={() => revoke.mutate(inv.id)}
                        >
                          {t('common.revoke')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={(o) => {
          setInviteOpen(o);
          if (!o && params.get('invite')) router.replace('/settings/team');
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('common.remove')}
        description={
          removing
            ? t('team.removeConfirm', { name: removing.name, company: me.tenant.name })
            : undefined
        }
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

export default function TeamPage() {
  return (
    <RequirePermission permission="members.read">
      <React.Suspense>
        <Team />
      </React.Suspense>
    </RequirePermission>
  );
}
