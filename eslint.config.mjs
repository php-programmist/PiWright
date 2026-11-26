import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'dist-server/**', 'node_modules/**', 'spec/**', 'resources/**', 'tmp/**', 'release/**', '.playwright-cli/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    files: ['tests/manual/**/*.cjs', 'scripts/**/*.cjs', 'server/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
)
