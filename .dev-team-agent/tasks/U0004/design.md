# Design — U0004: Pipeline Editor — lưu profile đúng project và round-trip pipeline schema

## §1. Tổng quan

Bug U0004 khiến thao tác Save/Load profile và Save to file trong Pipeline Editor không phản ánh đúng cấu hình pipeline của project đang chọn: monitor vẫn đúng (đọc `pipeline.yaml` qua `?project=`) nhưng file profile/`pipeline.yaml` trên project có thể ghi nhầm root hoặc thiếu field.

Giải pháp được chọn gồm hai phần độc lập, cùng triển khai trong một PR:

1. **Bug A** — Truyền `selectedProjectId` xuống Pipeline Editor và thêm `projectId?` cho mọi API client liên quan profile / pipeline-config-write, dùng helper `qs()` giống `fetchPipelineConfig`.
2. **Bug B** — Tách logic round-trip sang module pure `pipelineRoundTrip.ts`: giữ `pipelineMeta` (`version`, `defaults`, `doc_reviewer`) và `stepPreserved` (field step không chỉnh trên canvas) qua vòng load → chỉnh sửa → save; không thêm UI chỉnh defaults trong phase này.

Server routes **không đổi** — đã scope theo `c.get('root')` khi có `?project=`.

## §2. Investigation Summary

| Phát hiện | Ảnh hưởng design |
|---|---|
| `PipelineEditor` không nhận `selectedProjectId` từ `App.vue` | Thêm prop `projectId` và watch reload config + profile list |
| `fetchPipelineProfiles` / `savePipelineProfile` / `deletePipelineProfile` / `writePipelineConfig` thiếu `projectId?` | Đồng bộ pattern với `fetchPipelineConfig` |
| `buildPipelineFromFlow()` chỉ trả `{ version: 1, steps }` | Serialize phải merge `pipelineMeta` + preserved step fields |
| `buildFlowFromPipeline()` chỉ map subset field step lên node | Cần lưu phần còn lại (`export_key`, `rule_fallback_skill`, `hitl.retry`, …) |
| `loadPipelineConfig` server merge `defaults`/`doc_reviewer` từ file | File thiếu field → orchestrator dùng builtin — triệu chứng user report |
| Monitor embed `task.pipeline` từ `/api/tasks?project=X` | Không sửa monitor; fix editor ghi đúng chỗ |
| Orchestrator chỉ đọc `pipeline.yaml`, không đọc `pipeline-profiles/` | Out of scope đổi orchestrator |
| Câu hỏi investigate §7 đã có đề xuất | Phase 1: silent preserve; không UI defaults; Load profile không auto-write file |

**Acceptance criteria (từ investigate §6):** project scope đúng; round-trip `defaults` + `doc_reviewer`; load profile → save to file tương đương; monitor và orchestrator cùng đọc một `pipeline.yaml` sau Save to file; single-project regression.

## §3. So sánh giải pháp

### 3.1 Bug A — Multi-project scope

| Giải pháp | Ưu điểm | Nhược điểm | Lý do chọn/loại |
|---|---|---|---|
| **A — Prop `projectId` + `qs()` trên API client** | Khớp pattern hiện có (`fetchTasks`, `fetchPipelineConfig`); thay đổi tối thiểu server | Phải thread prop qua 2 component | ✅ **Được chọn** |
| **B — Vue provide/inject `projectId` toàn app** | Tránh prop drilling | Không có sẵn trong codebase; ẩn dependency | ❌ Over-engineering cho 2 component |
| **C — Lưu `projectId` trong localStorage riêng editor** | Không đổi `App.vue` | Lệch với project monitor đang chọn; dễ desync | ❌ Sai semantics |

### 3.2 Bug B — Round-trip pipeline schema

| Giải pháp | Ưu điểm | Nhược điểm | Lý do chọn/loại |
|---|---|---|---|
| **A — `pipelineMeta` + `stepPreserved` map + module pure** | Preserve silent; test unit không cần mount Vue; diff nhỏ | Hai state ref thêm trong editor | ✅ **Được chọn** |
| **B — Lưu nguyên object `pipeline` gốc, chỉ patch `steps` từ canvas** | Round-trip tự nhiên | Khó khi user xóa/thêm/re-id node; merge phức tạp khi topo đổi | ❌ Edge case nhiều |
| **C — Mở rộng UI StepConfigPanel cho mọi field YAML** | User chỉnh được `export_key`, `hitl.retry` | Scope lớn; không cần cho fix bug | ❌ Defer phase sau |
| **D — Giữ nguyên serialize, sửa server tự inject defaults khi write** | Client đơn giản | Che mất dữ liệu gốc project; profile không phản ánh file thật; sai contract orchestrator merge | ❌ |

## §4. Implementation Details

### 4.1 Files cần sửa

| File | Thay đổi | Lý do |
|---|---|---|
| `src/api/client.ts` | Thêm `projectId?` cho `fetchPipelineProfiles`, `fetchPipelineProfile`, `savePipelineProfile`, `deletePipelineProfile`, `writePipelineConfig`; dùng `qs({ project: projectId, ... })` | Bug A — API scope đúng project |
| `src/App.vue` | Pass `:project-id="selectedProjectId"` vào `PipelineEditor` | Thread project từ shell |
| `src/features/pipeline-editor/components/PipelineEditor.vue` | Prop `projectId`; state `pipelineMeta`, `stepPreserved`; dùng round-trip lib; truyền `projectId` xuống `ProfileManager`; watch `projectId` reload | Bug A + B tại entry editor |
| `src/features/pipeline-editor/components/ProfileManager.vue` | Prop `projectId`; truyền vào mọi API call; watch `projectId` → `loadProfiles()` | Bug A tại profile toolbar |
| `src/features/pipeline-editor/lib/pipelineRoundTrip.ts` **(mới)** | Pure functions extract/merge meta + preserved step fields | Testable; tách logic khỏi SFC |
| `tests/src/features/pipeline-editor/lib/pipelineRoundTrip.test.ts` **(mới)** | Vitest round-trip defaults, doc_reviewer, export_key, hitl.retry | Bug B regression |
| `tests/src/api/client.pipeline.test.ts` **(mới)** hoặc mở rộng test client hiện có | Assert URL có `?project=` khi `projectId` set | Bug A FE contract |
| `tests/server/http/api.golden.test.ts` | Thêm case: đăng ký project B → POST profile với `?project=B` → file nằm under `B/.dev-team-agent/pipeline-profiles/` | Bug A BE characterization |
| `tests/server/http/api.golden.test.ts` | Thêm case: `pipeline-config-write` với `?project=B` + body có `defaults`/`doc_reviewer` → đọc lại `GET /api/pipeline-config?project=B` khớp | Bug B + A integration |

**Không sửa:** `server/http/routes/config.ts`, `server/pipeline/index.ts`, `flow-profiles/`, orchestrator plugin.

### 4.2 Logic thay đổi

#### 4.2.1 API client — `projectId?` (Bug A)

Áp dụng pattern giống `fetchPipelineConfig`:

```ts
export async function fetchPipelineProfiles(projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ project: projectId })}`)
  // ...
}

export async function fetchPipelineProfile(name: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ name, project: projectId })}`)
  // ...
}

export async function savePipelineProfile(name: string, pipeline: unknown, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ project: projectId })}`, { method: 'POST', ... })
  // ...
}

export async function deletePipelineProfile(name: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ name, project: projectId })}`, { method: 'DELETE' })
  // ...
}

export async function writePipelineConfig(scope: string, pipeline: unknown, taskId?: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-config-write${qs({ project: projectId })}`, { method: 'POST', ... })
  // ...
}
```

`projectId` `null`/`undefined`/`''` → không gửi query param (default root) — giữ hành vi single-project.

#### 4.2.2 Props và reload khi đổi project (Bug A)

**`App.vue`:**

```vue
<PipelineEditor
  :scope="editorScope"
  :task-id="editorTaskId"
  :tasks="tasks"
  :project-id="selectedProjectId"
  :app-sidebar-collapsed="sidebarCollapsed"
  @update:scope="editorScope = $event"
  @update:task-id="editorTaskId = $event"
/>
```

**`PipelineEditor.vue`:**

```ts
const props = defineProps({
  // ...existing
  projectId: { type: [String, null], default: null },
})

watch(
  () => props.projectId,
  () => {
    loadConfig()
    // ProfileManager tự reload list qua prop watch riêng
  },
)
```

**`loadConfig`:**

```ts
const data = await fetchPipelineConfig(
  props.scope === 'task' ? props.taskId : null,
  props.projectId ?? undefined,
)
applyLoadedPipeline(data.pipeline)
```

**`saveToFile`:**

```ts
const pipeline = buildFullPipeline()
await writePipelineConfig(props.scope, pipeline, props.taskId || undefined, props.projectId ?? undefined)
```

**`ProfileManager.vue`:** prop `projectId`, mọi handler gọi API với `props.projectId ?? undefined`; `watch(() => props.projectId, loadProfiles)`.

#### 4.2.3 Module `pipelineRoundTrip.ts` (Bug B)

Định nghĩa type lỏng (`Record<string, unknown>`) — không bắt buộc Zod schema mới trong phase này (server validate `steps` array; giữ tương thích).

**Field node/canvas quản lý** (từ `StepConfigPanel` + node data):

`name`, `agent`, `skills`, `rule_category`, `rule_required`, `produces`, `knowledge_inputs`, `hitl` (subset UI).

**Field preserve trên step** (không mất khi round-trip):

`export_key`, `rule_fallback_skill`, và mọi key khác không thuộc nhóm trên; với `hitl` dùng **deep merge** — UI ghi đè `mode`, `gate_id`, `optional_doc_review`, `blocking`; giữ nguyên `retry` và key HITL khác nếu có.

```ts
/** Keys của step do canvas/UI quản lý — phần còn lại vào preserved */
const CANVAS_STEP_KEYS = new Set([
  'id', 'name', 'agent', 'skills', 'rule_category', 'rule_required',
  'produces', 'knowledge_inputs', 'hitl',
])

export type PipelineMeta = {
  version?: number
  defaults?: Record<string, unknown>
  doc_reviewer?: Record<string, unknown>
}

export type StepPreservedMap = Record<string, Record<string, unknown>>

export function extractPipelineMeta(pipeline: unknown): PipelineMeta {
  const p = pipeline as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object') return {}
  const meta: PipelineMeta = {}
  if (p.version != null) meta.version = p.version as number
  if (p.defaults && typeof p.defaults === 'object') meta.defaults = { ...(p.defaults as object) }
  if (p.doc_reviewer && typeof p.doc_reviewer === 'object') meta.doc_reviewer = { ...(p.doc_reviewer as object) }
  return meta
}

export function extractStepPreservedMap(steps: unknown[]): StepPreservedMap {
  const map: StepPreservedMap = {}
  for (const step of steps || []) {
    if (!step || typeof step !== 'object' || !('id' in step)) continue
    const s = step as Record<string, unknown>
    const id = String(s.id)
    const preserved: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s)) {
      if (!CANVAS_STEP_KEYS.has(k)) preserved[k] = v
    }
    if (Object.keys(preserved).length) map[id] = preserved
  }
  return map
}

function mergeHitl(preservedHitl: unknown, nodeHitl: unknown): unknown {
  if (!nodeHitl || (nodeHitl as any).mode === 'none') return { mode: 'none' }
  const base = preservedHitl && typeof preservedHitl === 'object' ? preservedHitl : {}
  return { ...base, ...(nodeHitl as object) }
}

/** Build một step YAML từ node + preserved */
export function buildStepFromNode(
  nodeData: Record<string, unknown>,
  stepId: string,
  preserved?: Record<string, unknown>,
): Record<string, unknown> {
  const fromNode = {
    id: stepId,
    name: nodeData.label || stepId,
    agent: nodeData.agent || '',
    skills: nodeData.skills || [],
    rule_category: nodeData.rule_category || '',
    rule_required: nodeData.rule_required ?? true,
    produces: nodeData.produces || [],
    knowledge_inputs: nodeData.knowledge_inputs || [],
    hitl: nodeData.hitl || { mode: 'none' },
  }
  const merged = { ...(preserved || {}), ...fromNode }
  merged.hitl = mergeHitl(preserved?.hitl, fromNode.hitl)
  return merged
}

/** Ghép meta + ordered steps thành pipeline object để POST */
export function assemblePipeline(
  meta: PipelineMeta,
  steps: Record<string, unknown>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (meta.version != null) out.version = meta.version
  else out.version = 1
  if (meta.defaults) out.defaults = { ...meta.defaults }
  out.steps = steps
  if (meta.doc_reviewer) out.doc_reviewer = { ...meta.doc_reviewer }
  return out
}
```

**`PipelineEditor.vue` state:**

```ts
import {
  extractPipelineMeta,
  extractStepPreservedMap,
  buildStepFromNode,
  assemblePipeline,
} from '../lib/pipelineRoundTrip'

const pipelineMeta = ref({})
const stepPreserved = ref({})

function applyLoadedPipeline(pipeline) {
  pipelineMeta.value = extractPipelineMeta(pipeline)
  stepPreserved.value = extractStepPreservedMap(pipeline?.steps || [])
  buildFlowFromPipeline(pipeline) // giữ nguyên — chỉ map steps → nodes
}

function buildFullPipeline() {
  const order = topoSort(getNodes.value, getEdges.value)
  const nodeMap = Object.fromEntries(getNodes.value.map((n) => [n.id, n]))
  const steps = order
    .map((id) => {
      const n = nodeMap[id]
      if (!n) return null
      return buildStepFromNode(n.data, id, stepPreserved.value[id])
    })
    .filter(Boolean)
  return assemblePipeline(pipelineMeta.value, steps)
}
```

**Thay thế:**

- `buildPipelineFromFlow()` → `buildFullPipeline()` (hoặc đổi tên internal, `currentPipeline` computed gọi `buildFullPipeline`).
- `loadConfig` / `onProfileLoad` → gọi `applyLoadedPipeline`.

**Node mới từ drag-drop:** không có entry trong `stepPreserved` — chỉ field UI (đúng hành vi hiện tại).

**Xóa node:** preserved entry cho `id` đó không cần xóa explicit (không xuất hiện trong topo order).

#### 4.2.4 Hành vi load profile vs load config

| Thao tác | `pipelineMeta` | `stepPreserved` |
|---|---|---|
| `loadConfig()` (global/task) | Từ `loadPipelineConfig` resolved (có defaults merge server) | Từ `pipeline.steps` |
| `onProfileLoad(pipeline)` | Từ profile YAML (có thể thiếu defaults) | Từ profile steps |
| Save profile / Save to file | Ghi đúng những gì đang giữ trong editor state | Steps merge preserved |

Không auto-write `pipeline.yaml` khi Load profile (giữ investigate §7.2).

#### 4.2.5 Test server multi-project (golden)

Trong `api.golden.test.ts` `beforeAll` đã có `localProj` + POST project. Mở rộng:

```ts
test('POST pipeline-profile scopes to ?project=', async () => {
  const added = await req('POST', '/api/projects', { body: JSON.stringify({ path: localProj }) })
  const { project } = await added.json()
  const pipeline = {
    version: 1,
    defaults: { auto_review: true },
    steps: [{ id: 's1', name: 'S1' }],
    doc_reviewer: { agent: 'a', rule_required: false },
  }
  const save = await req('POST', `/api/pipeline-profiles?project=${project.id}`, {
    body: JSON.stringify({ name: 'scoped', pipeline }),
  })
  expect(save.status).toBe(200)
  const profilePath = path.join(localProj, '.dev-team-agent', 'pipeline-profiles', 'scoped.yaml')
  expect(fs.existsSync(profilePath)).toBe(true)
  // default root không có file trùng tên (hoặc khác nội dung)
})
```

Fixture `pipeline.yaml` mẫu cho round-trip: copy structure từ `.dev-team-agent/pipeline.yaml` repo (có `export_key`, `rule_fallback_skill`, `hitl.retry`).

### 4.3 DB changes

Không có. Chỉ filesystem YAML dưới `.dev-team-agent/`.

### 4.4 Edge cases

| Case | Xử lý |
|---|---|
| `projectId` null (default project) | Không append `?project=` — regression single-project |
| Đổi project khi editor mở | Watch reload config + profile list; canvas replace từ config project mới |
| Profile YAML chỉ có `steps` | `pipelineMeta` rỗng → save không thêm `defaults`/`doc_reviewer` |
| Profile có đủ meta | Save giữ nguyên meta |
| Step có `hitl.retry` nhưng UI không expose | `mergeHitl` giữ `retry` từ preserved |
| User đổi HITL mode `manual` → `none` | Output `{ mode: 'none' }` — bỏ retry (đúng ý user tắt HITL) |
| Task scope + `projectId` | `fetchPipelineConfig(taskId, projectId)` và write tương tự — file `tasks/<id>/pipeline.yaml` under đúng root |
| `scope=task` write | Server vẫn thêm `steps_replace: true` — không đổi; meta (`defaults`, `doc_reviewer`) vẫn ghi nếu có trong body |
| Invalid / unknown `projectId` | Server trả lỗi như các API khác (`unknownProject`) — UI hiện error string sẵn có |
| Node id trùng sau load profile | Preserved map keyed by `id` — id ổn định từ YAML |

## §5. Test Notes

### Normal flow

- [ ] **Multi-project profile save:** Đăng ký project B → chọn B trên UI → Save profile → file tồn tại tại `B/.dev-team-agent/pipeline-profiles/<name>.yaml`, không tại default root.
- [ ] **Multi-project profile load/delete:** Load và Delete cùng scope B.
- [ ] **Save to file + project:** Chọn B → Save to file (global) → `B/.dev-team-agent/pipeline.yaml` cập nhật.
- [ ] **Round-trip meta:** Load config có `defaults` + `doc_reviewer` → Save profile → GET profile trả đủ meta.
- [ ] **Round-trip step extras:** Pipeline có `export_key`, `rule_fallback_skill`, `hitl.retry` → load editor → save → các field còn nguyên.
- [ ] **Acceptance #3:** Load profile đã lưu → Save to file → `GET /api/pipeline-config?project=B` tương đương (deep equal steps + defaults + doc_reviewer).

### Abnormal / regression

- [ ] **Default project:** Không chọn project → API không có `?project=` → hành vi như trước fix.
- [ ] **Đổi project:** Switch A → B → danh sách profile và canvas khớp project B.
- [ ] **Profile steps-only:** Không inject defaults khi save.
- [ ] **Vitest `pipelineRoundTrip`:** Case rỗng, thiếu meta, merge hitl retry.
- [ ] **`bun run test:all`:** CI xanh.

### Module phân công test

| Module | Runner | File gợi ý |
|---|---|---|
| Round-trip pure logic | vitest | `tests/src/features/pipeline-editor/lib/pipelineRoundTrip.test.ts` |
| Client URL `?project=` | vitest | `tests/src/api/client.pipeline.test.ts` |
| API scope profile/write | bun test | `tests/server/http/api.golden.test.ts` |

Reviewer mở rộng thành `test-spec.md` đầy đủ.

### 4.5 Git — branch & worktree (human decision)

> **Trạng thái:** branch **chưa xác nhận** (HITL feedback). Code **không** implement trên working tree hiện tại (`agent-workflow` gốc).

Theo `.claude/rules/worktree.md`: mỗi task → **1 worktree riêng**, branch riêng, đặt **ngoài** cây repo chính.

| Hạng mục | Giá trị |
|---|---|
| Working tree gốc (orchestrator / artifact) | `c:\Users\tuan1\workspace\agent-workflow` — chỉ `.dev-team-agent/tasks/U0004/*`, không commit code fix ở đây |
| Worktree implement (dự kiến) | `../wt-U0004` (anh em repo gốc) — **TBD path cuối** |
| Branch (dự kiến) | `feat/U0004/<slug>` — **chưa xác nhận**; gợi ý `feat/U0004/pipeline-profile-roundtrip` |
| Base branch | `origin/main` (fetch mới nhất trước khi `worktree add`) |

**Lệnh scaffold (chạy sau khi human xác nhận branch):**

```bash
git fetch origin
git worktree add -b <branch-name> ../wt-U0004 origin/main
cd ../wt-U0004
bun install
```

**Runtime cô lập (nếu chạy dev/test song song với instance khác):**

- `DEV_TEAM_DASHBOARD_PORT` — tránh đụng `:5174`
- `DEV_TEAM_DASHBOARD_HOME` — registry riêng per worktree
- `E2E_PORT` — nếu chạy Playwright

**Implementer:** chỉ commit/push trong worktree đã tạo; artifact pipeline (`investigate.md`, `design.md`, …) vẫn nằm ở `.dev-team-agent/` trên repo gốc (hoặc sync thủ công nếu dashboard đọc từ worktree).

## §6. Out of scope

- Orchestrator đọc trực tiếp từ `pipeline-profiles/` (contract: chỉ `pipeline.yaml`).
- UI chỉnh `defaults` / `doc_reviewer` trong Pipeline Editor.
- `flow-profiles/` (layout monitor) — không liên quan bug.
- Thay đổi `loadPipelineConfig` merge logic server.
- Zod schema pipeline toàn cục (có thể follow-up nếu cần SSOT).
- E2E Playwright pipeline editor (có spec mount canvas — không bắt buộc cho fix này trừ khi implementer thêm nhanh).

## §7. Schedule

| Phase | Ước tính | Ghi chú |
|---|---|---|
| Implementation — Bug A (API + props) | 0.5 ngày | Thread `projectId`, watch reload |
| Implementation — Bug B (round-trip lib + editor) | 0.5–1 ngày | Pure module + wire editor |
| Tests (vitest + golden) | 0.5 ngày | Theo §5 |
| Review + CI | 0.5 ngày | `test:all` |
