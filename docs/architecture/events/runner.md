# Events — Runner (job lifecycle, cấu hình)

← [`README.md`](README.md)

## State chart — vòng đời job

```mermaid
stateDiagram-v2
  [*] --> Queued: job.queued
  Queued --> Started: job.started
  Queued --> Cancelled: job.cancelled
  Started --> Finished: job.finished
  Started --> Failed: job.failed
  Started --> AwaitingRecovery: job.awaiting_recovery (usage_limit / network)
  Started --> RetryScheduled: job.retry_scheduled (process_crash, còn attempt)
  AwaitingRecovery --> Queued: job.recovered
  RetryScheduled --> Queued: job.recovered
  Finished --> [*]
  Failed --> [*]
  Cancelled --> [*]
```

## Flow chart — submit đến kết thúc

```mermaid
flowchart TD
  A[submitJob] --> B[saveJob persist] --> C[job.queued]
  C --> D[Worker: runJob]
  D --> E[job.started]
  E --> F{Kết quả}
  F -->|OK| G[job.finished]
  F -->|Lỗi| H{classifyJobFailure}
  H -->|usage_limit / network| I[job.awaiting_recovery]
  H -->|process_crash, còn attempt| J[job.retry_scheduled]
  H -->|khác| K[job.failed]
  I --> L[recoverPoller: resumeRecoveredJob]
  J --> L
  L --> M[job.recovered] --> C
```

## Event — job lifecycle

| Event | Khi nào | Payload gợi ý | Nơi emit |
|-------|---------|---------------|----------|
| `job.queued` | `submitJob` sau `saveJob` | `jobId`, `runnerId`, `taskId?`, `projectId?` | `runner/business/jobQueue.ts` |
| `job.started` | Worker bắt đầu chạy | `jobId`, `runnerId`, `providerId`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.finished` | Kết thúc thành công | `jobId`, `status`, `taskId?`, `projectId?` | `jobQueue.ts` |
| `job.failed` | Lỗi / early-fail (no runner, cred, prompt, …) | `jobId`, `error?`, `taskId?`, `projectId?` | `jobQueue.ts` |
| `job.cancelled` | `cancelJob` sau persist | `jobId`, `taskId?`, `projectId?` | `jobQueue.ts` |
| `job.awaiting_recovery` | Fail do `usage_limit`/`network` (`classifyJobFailure`) — non-terminal, chờ tự resume | `jobId`, `kind`, `resumeAfter`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.retry_scheduled` | Fail do `process_crash`, còn attempt — tự retry sau backoff | `jobId`, `attemptCount`, `resumeAfter`, `taskId?`, `projectId?` | `jobQueue.ts` `runJob` |
| `job.recovered` | Poller (`recoverPoller.ts`) resume job từ `awaiting_recovery`/backoff về `queued` | `jobId`, `kind`, `taskId?`, `projectId?` | `recoverPoller.ts` `resumeRecoveredJob` |

## Event — CRUD cấu hình

| Event | Entity (`payload.entity`) | Khi nào |
|-------|---------------------------|---------|
| `entity.updated` / `entity.deleted` | `runner` | Upsert / xóa runner |
| `entity.updated` / `entity.deleted` | `connection` | Upsert / xóa connection (chọn provider config + credential riêng, tự chứa providerId/credentialId) |
| `entity.updated` / `entity.deleted` | `provider-config` | Upsert / xóa provider config (interface + baseURL, không còn bao gồm credential) |
| `entity.updated` / `entity.deleted` | `command` | Upsert / xóa command |
| `entity.updated` / `entity.deleted` | `credential` | Upsert / xóa credential profile |

Nơi emit: `runner/controller.ts` (sau mutation OK).
