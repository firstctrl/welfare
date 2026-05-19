module.exports = {
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@welfare/shared(.*)$': '<rootDir>/../../../packages/shared/src$1',
  },
};
