import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const noEnum = {
  selector: 'TSEnumDeclaration',
  message: 'Không dùng TypeScript enum — dùng union literal type (docs/agent-rules/coding-guideline.md).',
}

const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message:
    'Không dùng default export trừ *.vue / vite.config.* / vitest.config.* / playwright.config.* / *.d.ts (docs/agent-rules/coding-guideline.md).',
}

/** MVP: recommended giữ nguyên nhưng hạ error → warn để CI xanh (không --max-warnings 0). */
const warnFirstRecommended = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': 'warn',
  '@typescript-eslint/no-empty-object-type': 'warn',
  '@typescript-eslint/no-require-imports': 'warn',
  'no-undef': 'warn',
  'no-unused-vars': 'warn',
  'no-useless-assignment': 'warn',
  'no-useless-escape': 'warn',
  'no-empty': 'warn',
  'no-constant-condition': 'warn',
  'prefer-const': 'warn',
  'vue/multi-word-component-names': 'warn',
  'vue/no-unused-vars': 'warn',
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.dev-team-agent/**',
      'node_modules/**',
      '.claude/**',
      'logs/**',
      'test-e2e/.runtime/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  {
    files: [
      'src/**/*.{ts,tsx,js}',
      'src/backend/**/*.{ts,tsx,js,mjs}',
      'src/shared/**/*.ts',
      'src/features/**/api.ts',
      'src/features/**/controller.ts',
      'src/features/**/business/**/*.{ts,tsx,js}',
      'mcp/**/*.{ts,tsx,js}',
      'tests/**/*.{ts,tsx,js,mjs}',
      'test-e2e/**/*.{ts,tsx,js,mjs}',
    ],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Bun: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      ...warnFirstRecommended,
      'no-restricted-syntax': ['warn', noEnum, noDefaultExport],
    },
  },

  {
    files: ['src/**/*.vue', 'tests/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
    rules: {
      ...warnFirstRecommended,
      'vue/block-lang': ['warn', { script: { lang: 'ts' } }],
      'vue/component-api-style': ['warn', ['script-setup']],
      'no-restricted-syntax': ['warn', noEnum],
    },
  },

  // ── Ranh giới scope: src/backend ⟂ src/frontend, src/shared thuần ──────────
  //
  // `no-restricted-imports` khớp minimatch trên **chuỗi specifier**, nên pattern
  // `**/backend/**` bắt được cả dạng relative (`../../backend/log/store.js`) —
  // không cần alias theo bucket. Mức `warn` để đồng bộ triết lý của file này
  // (recommended hạ error → warn, CI không dùng `--max-warnings 0`).
  {
    // `files` phải phủ TRỌN phần frontend của feature, không chỉ 3 thư mục hiển nhiên:
    // `lib/` · `schemas/` · `locales/` · `registerMode.ts` cũng là FE, và trước đây chúng
    // rơi vào vùng chết của cả hai hàng rào (rule BE chỉ nhận `api.ts`/`controller.ts`/
    // `business/**`). `schemas/` đặc biệt đáng phủ: architecture.md §6 mô tả nó là schema
    // dùng chung FE/BE, nên nó là đường ngắn nhất để một component kéo `src/backend/**` vào.
    files: [
      'src/frontend/**/*.{ts,vue}',
      'src/features/**/{components,composables,scripts,lib,schemas,locales}/**/*.{ts,vue}',
      'src/features/*/registerMode.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/backend/**', 'node:*', 'bun:*', 'hono', 'hono/*', 'drizzle-orm', 'drizzle-orm/*'],
              message:
                'Code frontend không được import scope backend hay module Node-only — xem src/frontend/README.md.',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      'src/backend/**/*.ts',
      'src/features/**/api.ts',
      'src/features/**/controller.ts',
      'src/features/**/business/**/*.{ts,js}',
    ],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/frontend/**', 'vue', 'vue/*'],
              message: 'Code backend không được import scope frontend — xem src/backend/README.md.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: [
                '**/backend/**',
                '**/frontend/**',
                'node:*',
                'bun:*',
                'hono',
                'hono/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'vue',
                'vue/*',
              ],
              message:
                'src/shared/ chỉ chứa logic/type thuần — không hạ tầng, không import bucket khác. Xem src/shared/README.md.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['vite.config.*', 'vitest.config.*', 'playwright.config.*'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      ...warnFirstRecommended,
      'no-restricted-syntax': ['warn', noEnum],
    },
  },

  {
    files: ['**/*.d.ts'],
    rules: {
      ...warnFirstRecommended,
      'no-restricted-syntax': ['warn', noEnum],
    },
  },

  eslintConfigPrettier,
)
