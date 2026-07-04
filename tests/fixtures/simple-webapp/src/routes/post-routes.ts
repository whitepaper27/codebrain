/**
 * Post routes — HTTP endpoints for post operations.
 */

import { PostService } from '../services/post-service.js';

/** Router interface (simplified Express-like). */
export interface PostRouter {
  get(path: string, handler: (req: unknown, res: unknown) => void): void;
  post(path: string, handler: (req: unknown, res: unknown) => void): void;
}

/** Create post routes and attach to a router. */
export function createPostRoutes(
  router: PostRouter,
  postService: PostService,
): PostRouter {
  router.get('/posts/:id', async (req, res) => {
    const post = await postService.getPost('some-id');
    return post;
  });

  router.get('/posts/:id/comments', async (req, res) => {
    const comments = await postService.getComments('some-id');
    return comments;
  });

  router.post('/posts', async (req, res) => {
    const post = await postService.createPost('Title', 'Body', 'author-id');
    return post;
  });

  return router;
}
