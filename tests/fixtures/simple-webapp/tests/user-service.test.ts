/**
 * Tests for UserService.
 */

import { UserService } from '../src/services/user-service.js';
import { Database } from '../src/core/database.js';

function createMockDb(): Database {
  return new Database({
    host: 'localhost',
    port: 5432,
    database: 'test',
    username: 'test',
    password: 'test',
  });
}

async function testGetUser(): Promise<void> {
  const db = createMockDb();
  const service = new UserService(db);
  const user = await service.getUser('123');
  // assert user is null since mock db returns empty
}

async function testListUsers(): Promise<void> {
  const db = createMockDb();
  const service = new UserService(db);
  const users = await service.listUsers();
  // assert users is empty array
}

async function testCreateUser(): Promise<void> {
  const db = createMockDb();
  const service = new UserService(db);
  const user = await service.createUser('test@test.com', 'Test');
  // assert user has expected fields
}
