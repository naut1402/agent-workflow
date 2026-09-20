# Config shell

← [`../README.md`](../README.md) (Cấp 4 · Code)

Preference/version shell tách theo scope chạy: `src/frontend/configs/` cho preference đọc trên browser, `src/backend/configs/` cho thứ phải đọc `package.json`. Không import HTTP kernel; domain/business import configs + `lib` + `registry` khi cần. Đọc khi không chắc 1 setting nên đặt ở đâu — preference shell hay schema business của feature.

| File / thư mục | Vai trò |
|---|---|
| `src/frontend/configs/appSettings.ts` | Preference shell (theme/locale/notifications UI); core/plugins dùng. **Không** nhầm với schema business của feature `settings` (`autoscan`, `dashboardSettings`, `githubTokens`, `scanPatterns` ở `features/settings/schemas/`). |
| `src/backend/configs/appVersion.ts` | Semver từ `package.json`. |
| `src/features/<feature>/schemas/` | Schema domain (task, log, autoscan, …) — Zod + `z.infer`, validate biên I/O của feature đó. |
| `src/backend/lib/` | Helper Node-only: `fileHelper` (`resolvePathUnder`), `processHelper`, `yamlLib`, `dirModuleLoader`, `arrayUtils`, `dateUtils`. |
| `src/frontend/lib/` | Helper thuần browser: `theme`, `markdownLib`, `diffLib`, `authToken`, `workflowSteps`, `pipelineArtifactGraph`, `appVersion`. |
| `src/shared/lib/` | Logic thuần dùng cả hai phía: `phase`, `stringUtils`. |
| `src/features/agent-editor/business/agentMarkdown.js` | Round-trip agent markdown (**vẫn `.js`**) — sở hữu agent-editor; peer import sâu `agentMarkdown.js` khi cần tránh cycle. |

Sanitize / peer API gắn vào business hiện có và **re-export qua `business/index.ts`** khi feature khác cần dùng. Feature tiêu thụ chỉ import peer từ **index của chính nó**, không import thẳng `features/<khác>/business/...` (trừ khi tránh vòng barrel — xem feature-organization-rule).
