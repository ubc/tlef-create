import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

beforeAll(async () => {
  // Use test database (you can create a separate test database)
  const testDbUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/tlef_test';
  await mongoose.connect(testDbUri);
});

afterAll(async () => {
  // Clean up database connections
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

afterEach(async () => {
  // Clean up all collections after each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});

// Global test timeout
jest.setTimeout(30000);