import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Security: data must never be written as HTML (legacy defect #7).
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent / el() helper.' },
        { property: 'outerHTML', message: 'Use textContent / el() helper.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'No HTML injection.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
