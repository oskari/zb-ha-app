import tseslint from 'typescript-eslint';

// ── Engineering constraint enforcement rules for the server codebase ────────
// See ENGINEERING_CONSTRAINTS.md for the full rule set.
// src/engine/ is globally ignored — it is frozen per Engineering constraint §1.

export default [
  {
    ignores: [
      'dist/**',
      'builder/**',
      'fonts/**',
      'public/**',
      'ignore/**',
      'src/engine/**',
    ],
  },

  // All server TypeScript files
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Engineering constraint §2: No browser dialogs
      'no-restricted-globals': ['error',
        { name: 'alert', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
        { name: 'confirm', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
        { name: 'prompt', message: 'No browser dialogs. See ENGINEERING_CONSTRAINTS.md §2.' },
      ],
      // Engineering constraint §Security 10: No eval or dynamic code generation
      'no-eval': 'error',
      'no-new-func': 'error',
      // Route all diagnostics through the redacting logger (logInfo/logWarn/
      // logError) so tokens, source URLs, and filesystem paths never leak into
      // HA container logs. src/core/logger.ts is exempted below; src/engine/**
      // is globally ignored (frozen).
      'no-console': 'error',
    },
  },

  // The logger is the single place permitted to call console — it writes the
  // redacted JSON log lines that logInfo/logWarn/logError produce.
  {
    files: ['src/core/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Core ↔ HA boundary: core must not import from ha/
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../ha/*', '../ha'],
          message: 'Core must not import from ha/. See ARCHITECTURE.md import rules.',
        }],
      }],
    },
  },

  // Expression engine source-of-truth: non-engine, non-shim code MUST import
  // the expression engine from @zb/expressions, not from src/expressions/*.
  // src/expressions/ exists only as a thin shim because the frozen src/engine/
  // imports from it (Engineering constraint §1). src/engine/** is globally ignored above.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/expressions/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/expressions/bindingResolver',
            '**/expressions/context',
          ],
          message:
            'Import the expression engine from "@zb/expressions". src/expressions/ is a frozen-engine shim only. See ENGINEERING_CONSTRAINTS.md §6.',
        }],
      }],
    },
  },
];
