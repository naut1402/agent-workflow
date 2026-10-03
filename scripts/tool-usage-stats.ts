#!/usr/bin/env bun
// Tool-usage statistics over the `tool-call` log.
//
//   bun run scripts/tool-usage-stats.ts [flags]
//
//   --from=<ISO|epoch>        Time bounds.
//   --to=<ISO|epoch>
//   --project=<id>            Filter by project / task / agent.
//   --task=<id>
//   --agent=<agentRef>
//   --format=table|json|markdown   Default `table`; `markdown` pipes into reports/.
//   --top=<n>                 Rows per table, default 15.
//   --exclude-session=<id>    Repeatable. $CLAUDE_SESSION_ID is always added.
//   --include-sidechain       Subagent calls are excluded by default.
//   --from-transcripts        Skip the log; scan ~/.claude/projects + agent-sdk-sessions
//                             and report straight off them. Works even when the
//                             `tool-call` log type has never been switched on.
//   --ingest                  Only with --from-transcripts: write what was scanned
//                             into the log. Idempotent per jobId, so a second run
//                             ingests nothing.
//
// With no flags it reads the already-ingested log — which is the point: you should
// not have to re-read every transcript to get the numbers again.
//
// Thin CLI by design: parse argv, call business, print. The backfill dedupe lives
// in `features/statistics/business/toolCallStats.ts` so it has a testable surface.
import {
  aggregateToolUsage,
  collectFromTranscripts,
  ingestFromTranscripts,
  readToolCallEntries,
} from '../src/features/statistics/business/toolCallStats.js'
import { isLogTypeEnabled } from '../src/backend/log/loggingPrefsIo.js'
import type { ToolUsageReport } from '../src/features/statistics/schemas/toolCallStats.js'

const FORMATS = ['table', 'json', 'markdown'] as const
type Format = (typeof FORMATS)[number]

interface Args {
  from?: string
  to?: string
  project?: string
  task?: string
  agent?: string
  format: Format
  top: number
  excludeSessions: string[]
  includeSidechain: boolean
  fromTranscripts: boolean
  ingest: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    format: 'table',
    top: 15,
    excludeSessions: [],
    includeSidechain: false,
    fromTranscripts: false,
    ingest: false,
  }
  for (const arg of argv) {
    const [flag, ...rest] = arg.split('=')
    const value = rest.join('=')
    switch (flag) {
      case '--from': args.from = value; break
      case '--to': args.to = value; break
      case '--project': args.project = value; break
      case '--task': args.task = value; break
      case '--agent': args.agent = value; break
      case '--top': args.top = Number(value) > 0 ? Math.floor(Number(value)) : args.top; break
      case '--exclude-session': if (value) args.excludeSessions.push(value); break
      case '--include-sidechain': args.includeSidechain = true; break
      case '--from-transcripts': args.fromTranscripts = true; break
      case '--ingest': args.ingest = true; break
      case '--format':
        if ((FORMATS as readonly string[]).includes(value)) args.format = value as Format
        break
      default: break
    }
  }
  return args
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

function renderTable(rows: string[][], headers: string[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const line = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd()
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

function markdownTable(rows: string[][], headers: string[]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

interface Section {
  title: string
  headers: string[]
  rows: string[][]
}

function sectionsOf(report: ToolUsageReport, top: number): Section[] {
  return [
    {
      title: 'Tool frequency',
      headers: ['tool', 'calls', 'share', 'sessions'],
      rows: report.byTool
        .slice(0, top)
        .map((r) => [r.name, String(r.calls), pct(r.share), String(r.sessions)]),
    },
    {
      title: 'Bash intents (share of Bash calls; one call can carry several)',
      headers: ['intent', 'calls', 'share'],
      rows: report.bashIntents.slice(0, top).map((r) => [r.intent, String(r.calls), pct(r.share)]),
    },
    {
      title: 'Adjacent command pairs',
      headers: ['from', 'to', 'count', 'share'],
      rows: report.bigrams
        .slice(0, top)
        .map((r) => [r.from, r.to, String(r.count), pct(r.share)]),
    },
    {
      title: 'Bootstrap files (first 3 calls of each job)',
      headers: ['file', 'reads', 'sessions'],
      rows: report.bootstrap.slice(0, top).map((r) => [r.file, String(r.reads), String(r.sessions)]),
    },
    {
      title: 'MCP adoption',
      headers: ['tool', 'calls', 'share', 'sessions'],
      rows: report.mcpAdoption.byTool
        .slice(0, top)
        .map((r) => [r.name, String(r.calls), pct(r.share), String(r.sessions)]),
    },
  ]
}

function summaryLines(report: ToolUsageReport): string[] {
  const { coverage, perSession, mcpAdoption } = report
  const span =
    coverage.firstTs && coverage.lastTs
      ? `${new Date(coverage.firstTs).toISOString()} … ${new Date(coverage.lastTs).toISOString()}`
      : 'n/a'
  return [
    `entries=${coverage.entries} jobs=${coverage.jobs} truncated=${coverage.truncatedEntries}`,
    `span: ${span}`,
    `bashSessions=${perSession.bashSessions} medianBash=${perSession.medianBashCalls} maxBash=${perSession.maxBashCalls} top10Share=${pct(perSession.top10Share)}`,
    `survey loop (read/grep pairs): ${pct(report.surveyLoopShare)}`,
    `MCP adoption: ${mcpAdoption.mcpCalls}/${mcpAdoption.totalCalls} calls (${pct(mcpAdoption.share)})`,
  ]
}

function print(report: ToolUsageReport, args: Args): void {
  if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const sections = sectionsOf(report, args.top)
  if (args.format === 'markdown') {
    const out = ['# Tool usage', '', ...summaryLines(report).map((l) => `- ${l}`), '']
    for (const s of sections) {
      out.push(`## ${s.title}`, '', markdownTable(s.rows, s.headers), '')
    }
    console.log(out.join('\n'))
    return
  }

  console.log(summaryLines(report).join('\n'))
  for (const s of sections) {
    console.log(`\n${s.title}`)
    console.log(renderTable(s.rows, s.headers))
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  // `--ingest` writes; refusing it without `--from-transcripts` keeps a typo from
  // quietly doing nothing (or worse, something unexpected).
  if (args.ingest && !args.fromTranscripts) {
    console.error('--ingest requires --from-transcripts (it backfills the log from transcripts).')
    return 2
  }

  // The transcript scan never touches the log, so it runs regardless of the log
  // type — it is the only way to see the 2,9% of jobs whose transcripts survive
  // when `tool-call` has never been switched on.
  if (args.fromTranscripts) {
    if (args.ingest) {
      const result = await ingestFromTranscripts({})
      console.log(
        `ingested=${result.ingested} skipped=${result.skipped} noTranscript=${result.noTranscript}`,
      )
      return 0
    }
    const { entries, summary } = await collectFromTranscripts({})
    console.error(
      `[from-transcripts] jobs with entries=${summary.ingested} skipped=${summary.skipped} `
      + `noTranscript=${summary.noTranscript} (nothing written — add --ingest to persist)`,
    )
    print(aggregateToolUsage(entries, { includeSidechain: args.includeSidechain }), args)
    return 0
  }

  if (!isLogTypeEnabled('tool-call')) {
    console.log(
      'Log type `tool-call` is off, so there is nothing to read.\n'
      + 'Turn it on in Settings › Logging › "Tool call", then run some jobs.\n'
      + 'To report off the transcripts still on disk instead: --from-transcripts',
    )
    return 0
  }

  // G7/E8: the session running this script also writes tool calls. Excluding it is
  // the default, not an opt-in flag — counting yourself was a measured error.
  const excludeSessionIds = [...args.excludeSessions]
  const own = process.env.CLAUDE_SESSION_ID
  if (own) excludeSessionIds.push(own)

  const entries = await readToolCallEntries({
    from: args.from,
    to: args.to,
    projectId: args.project,
    taskId: args.task,
    agentRef: args.agent,
    excludeSessionIds,
  })

  print(aggregateToolUsage(entries, { includeSidechain: args.includeSidechain }), args)
  return 0
}

process.exitCode = await main()
