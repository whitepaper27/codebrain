/**
 * Database connection and query layer.
 * All services use this module to access persistent storage.
 */

import { DBConfig, User, Post, Comment } from './schema.js';

/** Database connection wrapper. */
export class Database {
  private config: DBConfig;
  private connected: boolean = false;

  constructor(config: DBConfig) {
    this.config = config;
  }

  /** Connect to the database. */
  async connect(): Promise<void> {
    this.connected = true;
  }

  /** Disconnect from the database. */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /** Run a raw query and return rows. */
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return [] as T[];
  }

  /** Find a user by ID. */
  async findUser(id: string): Promise<User | null> {
    const rows = await this.query<User>(
      'SELECT * FROM users WHERE id = ?',
      [id],
    );
    return rows[0] ?? null;
  }

  /** Find a post by ID. */
  async findPost(id: string): Promise<Post | null> {
    const rows = await this.query<Post>(
      'SELECT * FROM posts WHERE id = ?',
      [id],
    );
    return rows[0] ?? null;
  }

  /** Find comments for a post. */
  async findComments(postId: string): Promise<Comment[]> {
    return this.query<Comment>(
      'SELECT * FROM comments WHERE post_id = ?',
      [postId],
    );
  }
}
