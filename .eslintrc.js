module.exports = {
  env: { node: true, es2021: true, jest: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2021 },
  rules: {
    'no-unused-vars':  ['error', { argsIgnorePattern: '^_' }],
    'no-console':       'off',
    'no-undef':         'error',
    'prefer-const':     'warn',
    'eqeqeq':          ['warn', 'always'],
  },
  ignorePatterns: ['node_modules/', 'coverage/', 'uploads/'],
};
