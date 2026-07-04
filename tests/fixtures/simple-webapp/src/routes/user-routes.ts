/**
 * User routes — HTTP endpoints for user operations.
 */

import { UserService } from '../services/user-service.js';

/** Router interface (simplified Express-like). */
export interface Router {
  get(path: string, handler: (req: unknown, res: unknown) => void): void;
  post(path: string, handler: (req: unknown, res: unknown) => void): void;
}

/** Create user routes and attach to a router. */
export function createUserRoutes(
  router: Router,
  userService: UserService,
): Router {
  router.get('/users', async (_req, res) => {
    const users = await userService.listUsers();
    return users;
  });

  router.get('/users/:id', async (req, res) => {
    const user = await userService.getUser('some-id');
    return user;
  });

  router.post('/users', async (req, res) => {
    const user = await userService.createUser('test@example.com', 'Test');
    return user;
  });

  return router;
}
