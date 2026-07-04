/**
 * User service — business logic for user operations.
 */

import { User } from '../core/schema.js';
import { Database } from '../core/database.js';

/** Service for managing users. */
export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Get a user by ID. */
  async getUser(id: string): Promise<User | null> {
    return this.db.findUser(id);
  }

  /** List all users. */
  async listUsers(): Promise<User[]> {
    return this.db.query<User>('SELECT * FROM users');
  }

  /** Create a new user. */
  async createUser(
    email: string,
    name: string,
  ): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      email,
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return user;
  }
}
