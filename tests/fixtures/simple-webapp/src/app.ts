/**
 * Application setup — assembles routes into the Express app.
 */

import { createUserRoutes } from './routes/user-routes.js';
import { createPostRoutes } from './routes/post-routes.js';

/** Simplified Express-like application. */
export interface App {
  use(path: string, router: unknown): void;
  listen(port: number, callback?: () => void): void;
}

/** Create and configure the application. */
export function createApp(): App {
  const app: App = {
    use(_path: string, _router: unknown) {},
    listen(_port: number, callback?: () => void) {
      if (callback) callback();
    },
  };

  return app;
}
