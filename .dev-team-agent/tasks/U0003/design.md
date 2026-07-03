# Design — U0003 (F0003 documentation)

## Cấu trúc tài liệu

```text
docs/
  README.md          ← Hub epic F0003 (mới)
  deploy.md          ← Runtime Docker + Git + Runner A/B (cập nhật)
  ssh-remote.md      ← Luồng C (mở rộng)
  multi-env.md       ← Ops multi-instance (#43, mới)
```

## Nguyên tắc viết

- Tiếng Việt, checklist smoke test giữ nguyên ID (T40-D-xx).
- Mỗi doc có mục **Prerequisites**, **Quick start**, **Troubleshooting**.
- Liên kết issue bằng `Refs #39` / `Part of #40` — không dùng `Closes`.
- Không commit screenshot e2e vào `docs/`.

## Sơ đồ luồng (README)

```mermaid
flowchart TB
  subgraph deploy["Deploy (#40)"]
    D[Docker Compose]
    T[DEV_TEAM_API_TOKEN]
    H[/api/health]
  end
  subgraph onboard["Onboard project"]
    L[kind: local]
    G[kind: git — shallow clone]
    S[kind: ssh — remote path]
  end
  subgraph runners["Runners"]
    A[Luồng A — claude-code-server]
    B[Luồng B — dev push + sync]
    C[Luồng C — claude-code-ssh + pull cache]
  end
  deploy --> onboard
  onboard --> runners
```

## Mapping sub-issue → section

| Issue | File | Section |
| --- | --- | --- |
| #40 | deploy.md | §1–§5, bare-metal |
| #41 | deploy.md | §6, MCP |
| #42 | deploy.md | §7–§10 |
| #44 | ssh-remote.md | toàn bộ |
| #43 | multi-env.md | toàn bộ |

## Thay đổi docker-compose

- Xóa volume `workspaces:/workspaces` (không được code dùng).
- Giữ `dashboard-home:/data` — clone Git nằm tại `/data/workspaces/<id>/`.
- Document mount `/keys:ro` cho SSH credential `file:/keys/...`.

## API token UI

Document cách set token trong browser DevTools:

```javascript
localStorage.setItem('dev-team-api-token', '<token>')
```

Frontend đọc qua `src/shared/lib/authToken.ts` và gắn header mọi request.
