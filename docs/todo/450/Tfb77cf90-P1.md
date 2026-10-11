# Todo — Tfb77cf90-P1

- **Issue / epic:** #440 (sub issue của #450)
- **Loại nợ:** docs-convention
- **Branch / PR tạo nợ:** `dev/1.2.1/Tfb77cf90-P1_runner-provider-contract`
- **Ngày tạo:** 2026-10-11

### Vì sao hoãn

#440 tách hợp đồng `RunnerProvider` ra `runner/business/providers/RunnerProvider.ts`, gom lắp ráp provider + catalog vào `providers/providerRegistry.ts` và đổi tên file hiện thực (`claude-code-cli.ts` → `ClaudeCliProvider.ts` + `AbstractAgentCliProvider.ts`, `cursor-cli.ts` → `CursorCliProvider.ts`, `codex-cli.ts` → `CodexCliProvider.ts`, `console-command.ts` → `ConsoleCommandProvider.ts`, `agenticApiProvider.ts` → `AgenticApiProvider.ts` + `agenticWorkspaceTools.ts`, `openai-compatible-api.ts` → `OpenAiCompatibleProvider.ts`, `anthropic-compatible-api.ts` → `AnthropicCompatibleProvider.ts`, bỏ `agentCli.ts`). Tài liệu và comment dưới đây còn trỏ tên / vị trí cũ nhưng nằm ngoài ranh giới file của P1 trong đợt 1 (8 agent sửa song song), nên hoãn tới khi các PR đợt 1 vào `dev/1.2.1/chia-business-theo-abstraction`.

### Việc cần làm khi đối ứng

- [ ] `docs/architecture/code/runner.md` — mục `providerFamilyOf`: nguồn 1 là bản dựng sẵn trong `providers/providerRegistry.ts` (không còn `PROVIDER_CATALOG` ở `connections.ts`); `providerFamilyFromId` nằm ở `providers/providerRegistry.ts`. Bổ sung bố cục `providers/` mới, `ProviderDescriptor`, hook `listModels` / `captureUsage` / `complete` / `transcriptFormat` và `transcriptFormatOf()` · `agentTranscriptFile()`.
- [ ] `docs/mcp/client.md:121` và `docs/architecture/README.md:129` — chỗ lắp ráp cách giao MCP là `runner/business/providers/providerRegistry.ts` (không còn `registry.ts`); console-command mang `NoMcpDelivery` (Null Object) thay vì không khai delivery.
- [ ] `docs/agent-rules/feature-architecture-guideline.md` §2.1 (cột ví dụ) và §2.4 — đổi ví dụ `claude-code-cli.ts`, `codex-cli.ts`, `anthropic-compatible-api.ts`, `providers/claude-code-cli.ts` sang `ClaudeCliProvider.ts`, `CodexCliProvider.ts`, `AnthropicCompatibleProvider.ts`; §2.1 có thể dẫn `AbstractAgentCliProvider` làm ví dụ template method.
- [ ] Comment trỏ tên file cũ ở feature khác: `src/backend/devTeamApi.ts:22`, `src/backend/standalone.ts:111`, `src/features/logs/scripts/logSections.ts:2-3`, `src/features/mcp/business/CredentialResolver.ts:17`, `src/features/orchestrator/business/decisionLoop.ts:745`, `src/features/orchestrator/controller.ts:20` (+ `monitor` nếu #441 chưa sửa).
- [ ] Xoá file nợ này; xoá **cả thư mục** `docs/todo/` khi không còn file nợ nào
