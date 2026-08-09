/**
 * Vitest/Vite shim for zod 3.25+: named export `{ z }` from package root is
 * undefined under Vite, while the v3 external namespace works (`z.enum`, …).
 */
import * as z from '../../node_modules/zod/v3/external.js'

export { z }
export default z
export * from '../../node_modules/zod/v3/external.js'
