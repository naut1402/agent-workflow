import { z } from 'zod'

/**
 * Zod is the source of truth for the tool-usage report shape — the payload
 * `scripts/tool-usage-stats.ts` prints and the contract the report in `reports/`
 * is generated from.
 *
 * No `node:*` here: this bucket is reachable from the frontend graph, same rule
 * as `usageStats.ts` next to it.
 */

/** One row of the "which tool, how often" table. */
export const ToolFrequencySchema = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  /** Share of all counted calls, 0..1. */
  share: z.number().nonnegative(),
  /** Distinct sessions that called it — separates "one heavy session" from "everyone". */
  sessions: z.number().int().nonnegative(),
})
export type ToolFrequency = z.infer<typeof ToolFrequencySchema>

/**
 * One row of the Bash-intent table. `share` divides by the number of BASH calls,
 * not by all calls, and a single call can carry several intents — so these shares
 * legitimately add up to more than 1.
 */
export const BashIntentShareSchema = z.object({
  intent: z.string(),
  calls: z.number().int().nonnegative(),
  share: z.number().nonnegative(),
})

/** One adjacent pair of call labels within a single entry. */
export const BigramSchema = z.object({
  from: z.string(),
  to: z.string(),
  count: z.number().int().nonnegative(),
  share: z.number().nonnegative(),
})
export type Bigram = z.infer<typeof BigramSchema>

/** Per-session Bash cost — says whether to optimise long surveys or short jobs. */
export const PerSessionSchema = z.object({
  /** Sessions that made at least one Bash call — NOT the same as `byTool[].sessions`. */
  bashSessions: z.number().int().nonnegative(),
  medianBashCalls: z.number().nonnegative(),
  maxBashCalls: z.number().int().nonnegative(),
  /** Share of all Bash calls made by the 10 heaviest sessions, 0..1. */
  top10Share: z.number().nonnegative(),
})

/** A file read in the first few calls of a job — the evidence for `get_task_context`. */
export const BootstrapFileSchema = z.object({
  /** Basename only: the same file under different cwds must not split into rows. */
  file: z.string(),
  reads: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
})
export type BootstrapFile = z.infer<typeof BootstrapFileSchema>

/**
 * THE metric this whole log exists to produce: do the MCP tools get called at all?
 * It is what decides whether more MCP tools are worth building.
 */
export const McpAdoptionSchema = z.object({
  mcpCalls: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  share: z.number().nonnegative(),
  byTool: z.array(ToolFrequencySchema),
})

/** How much data the numbers above rest on — including what was cut off. */
export const ToolUsageCoverageSchema = z.object({
  entries: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  firstTs: z.number().nullable(),
  lastTs: z.number().nullable(),
  /** Entries whose `callsTotal` exceeded `calls.length` — i.e. hit the cap. */
  truncatedEntries: z.number().int().nonnegative(),
})

export const ToolUsageReportSchema = z.object({
  byTool: z.array(ToolFrequencySchema),
  bashIntents: z.array(BashIntentShareSchema),
  bigrams: z.array(BigramSchema),
  /** `read`/`grep` ping-pong as a share of all pairs — the survey-loop cost. */
  surveyLoopShare: z.number().nonnegative(),
  perSession: PerSessionSchema,
  bootstrap: z.array(BootstrapFileSchema),
  mcpAdoption: McpAdoptionSchema,
  coverage: ToolUsageCoverageSchema,
})
export type ToolUsageReport = z.infer<typeof ToolUsageReportSchema>

/** Alias matching the file name, for callers that validate the printed payload. */
export const toolCallStatsSchema = ToolUsageReportSchema
