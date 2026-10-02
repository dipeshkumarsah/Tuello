import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = { title: 'Foundations/Tokens' };
export default meta;

const swatches = [
  'bg',
  'bg-subtle',
  'bg-muted',
  'bg-emphasis',
  'fg',
  'fg-muted',
  'fg-subtle',
  'border',
  'border-strong',
  'primary',
  'danger',
];
const sizes = [
  ['xs', 12],
  ['sm', 13],
  ['base', 14],
  ['md', 16],
  ['lg', 20],
  ['xl', 24],
  ['2xl', 32],
] as const;

export const Colours: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {swatches.map((s) => (
        <div key={s} className="flex flex-col gap-1">
          <div
            className="h-12 rounded-md border border-border"
            style={{ background: `var(--tu-${s})` }}
          />
          <code className="text-xs">--tu-{s}</code>
        </div>
      ))}
    </div>
  ),
};

export const Type: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      {sizes.map(([name, px]) => (
        <p key={name} className={`text-${name}`}>
          {px}px · Calm, precise, editorial. <span className="tabular">$1,234.50 · 2026-10-02</span>
        </p>
      ))}
    </div>
  ),
};
