/**
 * Portable Runtime Package Resolver for Isolated Tests.
 *
 * Eliminates hardcoded absolute paths in test imports.
 * Resolves packages via standard node resolution first, then candidate roots
 * configured via environment variables (DSH_RUNTIME_DIR, DSH_RUNTIME_PATH, NODE_PATH).
 * Supports colon-separated path lists (e.g. DSH_RUNTIME_DIR=path1:path2).
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function importRuntime(pkgName) {
  // 1. Try standard bare specifier import
  try {
    const mod = await import(pkgName);
    return mod;
  } catch {}

  // 2. Try configured runtime roots from environment
  const envRoots = [
    ...(process.env.DSH_RUNTIME_DIR ? process.env.DSH_RUNTIME_DIR.split(path.delimiter) : []),
    ...(process.env.DSH_RUNTIME_PATH ? process.env.DSH_RUNTIME_PATH.split(path.delimiter) : []),
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []),
    process.cwd(),
  ].filter(Boolean);

  for (const root of envRoots) {
    try {
      let candidateRequire;
      try {
        candidateRequire = createRequire(path.join(root, 'package.json'));
      } catch {
        candidateRequire = createRequire(root);
      }
      const resolvedPath = candidateRequire.resolve(pkgName);
      const mod = await import(pathToFileURL(resolvedPath).href);
      return mod;
    } catch {}
  }

  throw new Error(`[runtime-resolver] Unable to resolve runtime package "${pkgName}". Set DSH_RUNTIME_DIR if testing outside DSH host.`);
}
