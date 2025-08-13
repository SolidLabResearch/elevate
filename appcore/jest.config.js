module.exports = {
  testRunner: "jest-jasmine2",
  testEnvironment: "jsdom",
  preset: "jest-preset-angular",
  roots: ["<rootDir>/src/"],
  testMatch: ["**/+(*.)+(spec).+(ts)"],
  setupFilesAfterEnv: ["<rootDir>/src/test.ts"],
  collectCoverage: true,
  coverageReporters: ["html"],
  coverageDirectory: "coverage/",
  transform: {
    '^.+\\.(ts|js|mjs|html)$': 'jest-preset-angular',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@angular|@ngrx|ngx-|angular-|@inrupt|jose)/)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
  setupFiles: ["<rootDir>/src/test-setup.js"],
  testTimeout: 10000,
};
