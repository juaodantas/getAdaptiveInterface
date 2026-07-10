/**
 * Script de validação de variáveis de ambiente
 * Usado em CI/CD e para verificação local
 */

const requiredVars = [
  'BIGQUERY_PROJECT_ID',
  'BIGQUERY_ANALYTICS_DATASET',
  'GEMINI_API_KEY',
  'ADMIN_KEY',
  'ISIS_JWT_SECRET',
];

const missing = requiredVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  console.error('❌ Variáveis de ambiente obrigatórias não configuradas:');
  missing.forEach(varName => console.error(`   - ${varName}`));
  process.exit(1);
}

console.log('✅ Todas as variáveis de ambiente obrigatórias estão configuradas');
console.log(`   - BIGQUERY_PROJECT_ID: ${process.env.BIGQUERY_PROJECT_ID}`);
console.log(`   - BIGQUERY_ANALYTICS_DATASET: ${process.env.BIGQUERY_ANALYTICS_DATASET}`);
console.log(`   - GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ configurada' : '❌ ausente'}`);
console.log(`   - SCHEDULER_SECRET: ${process.env.SCHEDULER_SECRET ? '✅ configurada' : '❌ ausente'}`);
console.log(`   - ADMIN_KEY: ${process.env.ADMIN_KEY ? '✅ configurada' : '❌ ausente'}`);
console.log(`   - ISIS_JWT_SECRET: ${process.env.ISIS_JWT_SECRET ? '✅ configurada' : '❌ ausente'}`);
process.exit(0);
