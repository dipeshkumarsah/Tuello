import base from '../../eslint.config.mjs';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  { ignores: ['.next/**', 'next-env.d.ts'] },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
