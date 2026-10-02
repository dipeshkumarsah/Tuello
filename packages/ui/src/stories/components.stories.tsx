import type { Meta, StoryObj } from '@storybook/react';
import { Inbox, Settings, Users } from 'lucide-react';
import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  CommandPalette,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
  EmptyState,
  ErrorState,
  Field,
  FileUploader,
  Input,
  NoPermissionState,
  Select,
  Skeleton,
  SkeletonRows,
  Status,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeProvider,
  ThemeToggle,
  toast,
  type ColumnDef,
} from '../index';

const meta: Meta = { title: 'Components' };
export default meta;
type S = StoryObj;

export const Buttons: S = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Delete</Button>
      <Button variant="link">Link</Button>
      <Button loading>Saving…</Button>
      <Button size="sm">Small</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Settings">
        <Settings size={16} strokeWidth={1.5} aria-hidden />
      </Button>
    </div>
  ),
};

export const Inputs: S = {
  render: () => {
    const [tz, setTz] = React.useState<string | null>('America/New_York');
    return (
      <div className="grid max-w-md gap-4">
        <Field label="Company name" hint="Shown to clients.">
          {(ids) => <Input {...ids} placeholder="Acme Media" />}
        </Field>
        <Field label="Email" error="Enter a valid email address.">
          {(ids) => <Input {...ids} defaultValue="not-an-email" />}
        </Field>
        <Field label="Currency">
          {(ids) => (
            <Select
              {...ids}
              defaultValue="USD"
              options={['USD', 'EUR', 'GBP'].map((c) => ({ value: c, label: c }))}
            />
          )}
        </Field>
        <Field label="Time zone">
          {(ids) => (
            <Combobox
              {...ids}
              value={tz}
              onValueChange={setTz}
              options={['America/New_York', 'Europe/London', 'Australia/Sydney'].map((z) => ({
                value: z,
                label: z,
              }))}
            />
          )}
        </Field>
      </div>
    );
  },
};

export const Dialogs: S = {
  render: () => {
    const [open, setOpen] = React.useState(false);
    return (
      <div className="flex gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They will receive an email with a link.</DialogDescription>
            <Field label="Email">{(ids) => <Input {...ids} />}</Field>
            <DialogFooter>
              <Button>Send invite</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Remove member
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Remove Ada?"
          description="They lose access immediately."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => setOpen(false)}
        />
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerTitle>Order details</DrawerTitle>
            <p className="text-fg-muted">Drawer content.</p>
          </DrawerContent>
        </Drawer>
      </div>
    );
  },
};

export const Toasts: S = {
  render: () => (
    <div className="flex gap-3">
      <Button variant="secondary" onClick={() => toast({ title: 'Saved' })}>
        Default
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast({ title: 'Invite sent', description: 'ada@example.com', tone: 'success' })
        }
      >
        Success
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ title: 'Could not save', description: 'Try again.', tone: 'error' })}
      >
        Error
      </Button>
    </div>
  ),
};

export const TabsStory: S = {
  name: 'Tabs',
  render: () => (
    <Tabs defaultValue="team">
      <TabsList>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="branding">Branding</TabsTrigger>
      </TabsList>
      <TabsContent value="team">Team content</TabsContent>
      <TabsContent value="branding">Branding content</TabsContent>
    </Tabs>
  ),
};

interface Member {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'invited';
}
const members: Member[] = [
  { id: '1', name: 'Olive Owner', role: 'Owner', status: 'active' },
  { id: '2', name: 'Cora Coordinator', role: 'Coordinator', status: 'active' },
  { id: '3', name: 'Sam Shooter', role: 'Shooter', status: 'invited' },
];
const columns: ColumnDef<Member, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'role', header: 'Role' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: (c) =>
      c.getValue() === 'active' ? (
        <Status fill="solid" label="Active" />
      ) : (
        <Status fill="outline" label="Invited" />
      ),
  },
];

export const Table: S = {
  render: () => (
    <DataTable caption="Team members" columns={columns} data={members} getRowId={(r) => r.id} />
  ),
};

export const StatusMarks: S = {
  render: () => (
    <div className="flex gap-6">
      <Status fill="outline" label="Booked" />
      <Status fill="half" label="Editing" />
      <Status fill="solid" label="Delivered" />
      <Status fill="solid" label="Failed" tone="danger" />
      <Badge>2FA</Badge>
    </div>
  ),
};

export const States: S = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <EmptyState
        icon={Users}
        title="Just you so far"
        body="Invite coordinators, shooters, and editors."
        action={<Button>Invite</Button>}
      />
      <ErrorState
        title="Something went wrong"
        body="Check your connection and try again."
        action={<Button variant="secondary">Try again</Button>}
      />
      <NoPermissionState
        title="You do not have access to this page"
        body="Ask an owner or admin."
      />
      <Card>
        <CardHeader title="Loading" />
        <div className="p-5">
          <SkeletonRows rows={3} />
          <Skeleton className="mt-3 h-4 w-1/2" />
        </div>
      </Card>
    </div>
  ),
};

export const Uploader: S = {
  render: () => (
    <div className="max-w-md">
      <FileUploader
        label="Upload logo"
        hint="PNG, JPG, SVG or WebP up to 2 MB."
        accept="image/*"
        maxBytes={2 * 1024 * 1024}
        upload={async (_file, onProgress) => {
          for (let i = 1; i <= 10; i++) {
            await new Promise((r) => setTimeout(r, 80));
            onProgress(i / 10);
          }
        }}
      />
    </div>
  ),
};

export const Palette: S = {
  render: () => {
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open (Ctrl/Cmd + K)
        </Button>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          actions={[
            { id: 'home', label: 'Home', group: 'Go to', icon: Inbox, run: () => {} },
            {
              id: 'team',
              label: 'Team',
              group: 'Go to',
              icon: Users,
              shortcut: 'G T',
              run: () => {},
            },
            { id: 'invite', label: 'Invite a team member', group: 'Actions', run: () => {} },
          ]}
        />
      </>
    );
  },
};

export const Theme: S = {
  render: () => (
    <ThemeProvider>
      <ThemeToggle labels={{ theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark' }} />
    </ThemeProvider>
  ),
};
