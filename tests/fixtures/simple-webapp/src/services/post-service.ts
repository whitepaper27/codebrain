/**
 * Post service — business logic for post operations.
 */

import { Post, Comment } from '../core/schema.js';
import { Database } from '../core/database.js';

/** Service for managing blog posts. */
export class PostService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Get a post by ID. */
  async getPost(id: string): Promise<Post | null> {
    return this.db.findPost(id);
  }

  /** List comments on a post. */
  async getComments(postId: string): Promise<Comment[]> {
    return this.db.findComments(postId);
  }

  /** Create a new post. */
  async createPost(
    title: string,
    body: string,
    authorId: string,
  ): Promise<Post> {
    const post: Post = {
      id: crypto.randomUUID(),
      title,
      body,
      authorId,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return post;
  }
}
