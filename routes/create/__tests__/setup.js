import mongoose from 'mongoose';
import { beforeAll, afterAll, afterEach } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

beforeAll(async () => {
  // Use test database — derive from MONGODB_URI if MONGODB_TEST_URI not set
  let testDbUri = process.env.MONGODB_TEST_URI;
  if (!testDbUri && process.env.MONGODB_URI) {
    // Replace the database name in the production URI with the test database
    testDbUri = process.env.MONGODB_URI.replace(/\/[^/?]+(\?|$)/, '/tlef_test$1');
  }
  testDbUri = testDbUri || 'mongodb://localhost:27017/tlef_test';
  await mongoose.connect(testDbUri);
}, 30000);

afterAll(async () => {
  // Clean up database connections
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
}, 30000);

afterEach(async () => {
  // Clean up all collections after each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});