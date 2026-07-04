/**
 * Tests for PostService.
 */

import { PostService } from '../src/services/post-service.js';
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

async function testGetPost(): Promise<void> {
  const db = createMockDb();
  const service = new PostService(db);
  const post = await service.getPost('456');
  // assert post is null since mock db returns empty
}

async function testGetComments(): Promise<void> {
  const db = createMockDb();
  const service = new PostService(db);
  const comments = await service.getComments('456');
  // assert comments is empty array
}

async function testCreatePost(): Promise<void> {
  const db = createMockDb();
  const service = new PostService(db);
  const post = await service.createPost('Title', 'Body', 'author-1');
  // assert post has expected fields
}
