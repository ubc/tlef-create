import dotenv from 'dotenv';

dotenv.config();

function withE2EDatabase(uri) {
  const parsed = new URL(uri);
  const currentName = parsed.pathname.replace(/^\//, '') || 'tlef-create';
  parsed.pathname = `/${currentName.replace(/-e2e$/, '')}-e2e`;
  return parsed.toString();
}

const sourceMongoUri = process.env.E2E_MONGODB_URI || process.env.MONGODB_URI;
if (!sourceMongoUri) {
  throw new Error('E2E requires E2E_MONGODB_URI or MONGODB_URI');
}

const e2eMongoUri = process.env.E2E_MONGODB_URI || withE2EDatabase(sourceMongoUri);
const databaseName = new URL(e2eMongoUri).pathname.replace(/^\//, '');
if (!databaseName.toLowerCase().includes('e2e')) {
  throw new Error(`Refusing to run E2E against non-E2E database: ${databaseName}`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '8051',
  FRONTEND_URL: 'http://localhost:8092',
  MONGODB_URI: e2eMongoUri,
  SAML_AVAILABLE: 'false',
  AUTO_LOGIN_ENABLED: 'true',
  ADMIN_CWLS: 'e2e-admin',
  SESSION_SECRET: process.env.E2E_SESSION_SECRET || 'local-e2e-session-secret',
  LTI_CLIENT_ID: ''
});

await import('../server.js');
