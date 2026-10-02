import type { MessageKey, Permission } from '@tuello/shared';
import {
  AlertTriangle,
  BadgeDollarSign,
  Building2,
  Contact,
  Package,
  Globe,
  Home,
  Palette,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  permission: Permission;
  /** Keyboard shortcut "g" then this key. */
  key?: string;
}

/** Navigation derived from the permissions matrix: each role sees only what it can open. */
export const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'nav.home', icon: Home, permission: 'self.manage', key: 'h' },
  { href: '/clients', label: 'nav.clients', icon: Contact, permission: 'clients.read', key: 'c' },
  {
    href: '/brokerages',
    label: 'nav.brokerages',
    icon: Building2,
    permission: 'clients.read',
    key: 'b',
  },
  { href: '/catalog', label: 'nav.catalog', icon: Package, permission: 'catalog.read', key: 'k' },
  {
    href: '/pricing',
    label: 'nav.pricing',
    icon: BadgeDollarSign,
    permission: 'pricing.read',
    key: 'p',
  },
  {
    href: '/settings/team',
    label: 'settings.team',
    icon: Users,
    permission: 'members.read',
    key: 't',
  },
  {
    href: '/settings/company',
    label: 'nav.settings',
    icon: Settings,
    permission: 'tenant.read',
    key: 's',
  },
  {
    href: '/admin/jobs',
    label: 'nav.jobs',
    icon: AlertTriangle,
    permission: 'jobs.read',
    key: 'j',
  },
];

export const SETTINGS_NAV: NavItem[] = [
  {
    href: '/settings/company',
    label: 'settings.company',
    icon: Settings,
    permission: 'tenant.read',
  },
  { href: '/settings/team', label: 'settings.team', icon: Users, permission: 'members.read' },
  {
    href: '/settings/branding',
    label: 'settings.branding',
    icon: Palette,
    permission: 'branding.read',
  },
  { href: '/settings/domains', label: 'settings.domains', icon: Globe, permission: 'domains.read' },
  {
    href: '/settings/profile',
    label: 'settings.profile',
    icon: ShieldCheck,
    permission: 'self.manage',
  },
];
