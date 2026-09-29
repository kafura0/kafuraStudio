import path from 'node:path';
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * AGENTS.md rule 3: imports flow downward only — `ui -> state -> core`.
 * The stack is enforced here because nothing else keeps a rogue `import ... from
 * '../../../state/editorStore'` out of `src/core`. Must never be weakened.
 *
 * Tiers: ui (3) may import anything; state (2) may import core/data/lib but never
 * ui; core/data/lib (1) import only peers. Relative imports resolve against the
 * importer's directory before the tier is compared.
 */
const TIER = (dir) => (dir === 'ui' ? 3 : dir === 'state' ? 2 : 1);

const noUpwardImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce downward-only imports across the src layers (AGENTS.md rule 3).' },
    messages: {
      upward:
        'Upward import: "{{from}}" jumps from the {{srcTier}} layer to the {{dstTier}} layer. Imports must flow ui -> state -> core (AGENTS.md rule 3).',
    },
  },
  create(context) {
    const fileDir = path.posix.dirname(context.getFilename().split(/[\\/]/).join('/')) + '/';
    const srcAt = fileDir.lastIndexOf('/src/');
    if (srcAt < 0) return {};
    const underSrc = fileDir.slice(srcAt + '/src/'.length);
    // A module at the src/ root (main.tsx) is the entry point: it sits at the top
    // of the stack and may import anything below it, tier 3 included.
    const dir = underSrc.split('/')[0];
    const srcTier = dir === '' ? 3 : TIER(dir);
    if (!srcTier) return {};
    return {
      ImportDeclaration(node) {
        const spec = node.source?.value;
        if (typeof spec !== 'string' || spec.startsWith('.') === false) return;
        const targetRel = path.posix.normalize(path.posix.join(underSrc, spec));
        const targetDir = targetRel.split('/')[0];
        const dstTier = TIER(targetDir);
        if (!dstTier) return;
        if (dstTier > srcTier) {
          context.report({
            node,
            messageId: 'upward',
            data: { from: spec, srcTier, dstTier },
          });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '*.config.js', '*.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      local: { rules: { 'no-upward-imports': noUpwardImports } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'local/no-upward-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
