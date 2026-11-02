import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Hook names follow the team rule: snake_case with a `use` prefix (use_tx, use_roles). The rule is
    // off only for these hook files, because the React rule insists on camelCase after `use`.
    files: ['src/hooks/**/*.ts'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
];
