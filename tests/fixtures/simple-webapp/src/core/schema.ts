/**
 * Core schema definitions for the webapp.
 * This is the source-of-truth for all domain types.
 */

/** Configuration for the database connection. */
export interface DBConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/** A registered user in the system. */
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A blog post authored by a user. */
export interface Post {
  id: string;
  title: string;
  body: string;
  authorId: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A comment on a post. */
export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  createdAt: Date;
}

/** Possible status values for a post. */
export type PostStatus = 'draft' | 'published' | 'archived';
