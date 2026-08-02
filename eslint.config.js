import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const noEnum = {
  selector: 'TSEnumDeclaration',
  message: 'Không dùng TypeScript enum — dùng union literal type (docs/implement/coding-convention.md).',
}

const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message:
    'Không dùng default export trừ *.vue / vite.config.* / vitest.config.* / playwright.config.* / *.d.ts (docs/implement/coding-convention.md).',
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
      'src/core/**/*.{ts,tsx,js,mjs}',
      'src/standalone.ts',
      'src/runner-cli.mjs',
      'src/features/**/api.ts',
      'src/features/**/controller.ts',
      'src/features/**/business/**/*.{ts,tsx,js}',
      'src/core/contracts/**/*.{ts,tsx,js}',
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
