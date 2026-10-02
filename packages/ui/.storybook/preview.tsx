import type { Decorator, Preview } from '@storybook/react';
import * as React from 'react';
import { Toaster } from '../src/components/toast';
import './preview.css';

/** Theme switcher in the toolbar: light, dark, or follow the OS. */
const withTheme: Decorator = (Story, ctx) => {
  const theme = ctx.globals.theme as string;
  React.useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return (
    <div className="bg-bg p-6 text-fg">
      <Story />
      <Toaster />
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: ['system', 'light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [withTheme],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    backgrounds: { disable: true },
  },
};
export default preview;
