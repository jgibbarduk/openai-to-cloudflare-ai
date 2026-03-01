module.exports = {
  preset: 'ts-jest/presets/default',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/http'],
  testMatch: ['**/*.integration-http.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {}]
  },
  globalSetup: '<rootDir>/tests/setup/wrangler.setup.ts',
  globalTeardown: '<rootDir>/tests/setup/wrangler.teardown.ts',
  // Integration tests hit a real worker; allow longer timeouts
  testTimeout: 30000,
  forceExit: true,
};

