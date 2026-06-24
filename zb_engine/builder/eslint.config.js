// ── Engineering constraint enforcement rules for the Widget Builder ─────────
// See ENGINEERING_CONSTRAINTS.md for the full rule set.

// Inline plugin: detect absolute URL paths in non-platform code (Engineering constraint §3)
const guiderailsPlugin = {
  rules: {
    'no-absolute-url-paths': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          forbidden:
            'Use relative paths (e.g., ./payload). No absolute URLs in non-platform code. See ENGINEERING_CONSTRAINTS.md §3.',
        },
      },
      create(context) {
        return {
          Literal(node) {
            if (
              typeof node.value === 'string' &&
              /^\/(?:api\/|payload|render|entities|history)/.test(node.value)
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
  },
};

export default [
  { ignores: ['dist/**'] },

  // All source files: ban browser dialogs
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Engineering constraint §2: No browser dialogs
      'no-restricted-globals': ['error',
        { name: 'alert', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
        { name: 'confirm', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
        { name: 'prompt', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
      ],
    },
  },

  // Expression engine source-of-truth: the builder MUST import the expression
  // engine from @zb/expressions. The legacy builder/src/utils/expressions.js
  // file was deleted during the expression-engine consolidation — this rule prevents resurrection.
  // Applied broadly first so the components/panels block below can layer the
  // platform restriction on top without losing this one.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/components/**', 'src/panels/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/utils/expressions',
            '**/utils/expressions.js',
          ],
          message:
            'Import the expression engine from "@zb/expressions". The builder-local copy was removed; do not recreate it. See ENGINEERING_CONSTRAINTS.md §6.',
        }],
      }],
    },
  },

  // Components & panels: ban platform imports (Engineering constraint §11) AND
  // ban resurrection of the deleted builder-local expression engine.
  {
    files: ['src/components/**/*.{js,jsx}', 'src/panels/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../platform/*', '../../platform/*', '../platform', '../../platform'],
            message:
              'Components/panels must not import from platform/. Use uiStore injection instead. See ENGINEERING_CONSTRAINTS.md §11.',
          },
          {
            group: [
              '**/utils/expressions',
              '**/utils/expressions.js',
            ],
            message:
              'Import the expression engine from "@zb/expressions". The builder-local copy was removed; do not recreate it. See ENGINEERING_CONSTRAINTS.md §6.',
          },
        ],
      }],
    },
  },

  // Non-platform code: ban absolute URL paths (Engineering constraint §3)
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/platform/**'],
    plugins: {
      guiderails: guiderailsPlugin,
    },
    rules: {
      'guiderails/no-absolute-url-paths': 'error',
    },
  },
];
