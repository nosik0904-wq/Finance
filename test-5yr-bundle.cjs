#!/usr/bin/env node

// Compatibility launcher. The source-of-truth test is test-5yr.mjs so it always
// runs against the current app modules instead of a stale bundled snapshot.
import('./test-5yr.mjs').catch((error) => {
  console.error(error);
  process.exit(1);
});
