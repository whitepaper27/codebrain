/**
 * Entry point — starts the server.
 */

import { createApp } from './app.js';

const PORT = 3000;

const app = createApp();

app.listen(PORT, () => {
  // Server started
});
