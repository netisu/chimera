/**
 * @netisu/chimera
 *
 * (c) netisu
 *
 * Path to the root directory where the stubs are stored. We use
 * this path within commands and the configure hook.
 *
 * Using __dirname is compatible with both CJS and ESM outputs.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const stubsRoot = dirname(fileURLToPath(import.meta.url))
