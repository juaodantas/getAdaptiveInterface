module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['index.js', 'src/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true,
};
