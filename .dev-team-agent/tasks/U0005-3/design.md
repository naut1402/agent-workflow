# Design ΓÇö U0005: T├¡ch hß╗úp agent v├áo pipeline dashboard

## ┬º1. Tß╗òng quan

Mß╗ƒ rß╗Öng dev-team-dashboard ─æß╗â ng╞░ß╗¥i d├╣ng **duyß╗çt HITL**, **tß║ío v├á chß║íy agent tß╗½ m├┤ tß║ú tß╗▒ nhi├¬n**, v├á **k├¡ch hoß║ít t├íc vß╗Ñ agent nhanh** ngay tr├¬n m├án h├¼nh monitor ΓÇö kh├┤ng bß║»t buß╗Öc quay lß║íi orchestrator CLI. Giß║úi ph├íp tß║¡n dß╗Ñng job queue v├á API runner ─æ├ú c├│, bß╗ò sung API ghi task state an to├án, UI t╞░╞íng t├íc tr├¬n pipeline node v├á artifact toolbar. Orchestrator plugin giß╗» nguy├¬n contract state; dashboard trß╗ƒ th├ánh control plane bß╗ò sung.

## ┬º2. Investigation Summary

- Dashboard **chß╗ë ─æß╗ìc** `.dev-state/*.json`; HITL approve hiß╗çn chß╗ë qua orchestrator chat.
- `PipelineNode` hiß╗ân thß╗ï icon status nh╞░ng kh├┤ng clickable; `phaseStatus` ─æ├ú ph├ón biß╗çt `waiting` ─æ├║ng.
- `POST /api/jobs` + `agentResolver` + `POST /api/custom-agents/generate` ─æß╗º cho chß║íy agent v├á NL draft.
- `ArtifactPanel` ch╞░a c├│ quick actions; `workflow-step-templates` l├á ─æiß╗âm mß╗ƒ rß╗Öng tß╗▒ nhi├¬n.
- Rß╗ºi ro ch├¡nh: race state khi CLI v├á dashboard c├╣ng sß╗¡a task ΓÇö giß║úm bß║▒ng optimistic concurrency (`mtime`) v├á audit.

## ┬º3. So s├ính giß║úi ph├íp

### 3.1 HITL approve tr├¬n monitor

| Giß║úi ph├íp | ╞»u ─æiß╗âm | Nh╞░ß╗úc ─æiß╗âm | Quyß║┐t ─æß╗ïnh |
|---|---|---|---|
| **A. Dashboard ghi state + user resume orchestrator** | ├ìt ─æß╗Ñng plugin; atomic API trong repo n├áy | Cß║ºn b╞░ß╗¢c resume thß╗º c├┤ng hoß║╖c t├ích | Γ£à Phase 1 |
| B. Dashboard gß╗ìi orchestrator headless sau approve | End-to-end tß╗▒ ─æß╗Öng | Phß╗Ñ thuß╗Öc remote runner + coupling chß║╖t | Phase 2 |
| C. Chß╗ë hiß╗ân thß╗ï link "mß╗ƒ chat approve" | Kh├┤ng code backend | Kh├┤ng ─æ├íp ß╗⌐ng y├¬u cß║ºu click icon | Γ¥î |

### 3.2 NL agent build

| Giß║úi ph├íp | ╞»u ─æiß╗âm | Nh╞░ß╗úc ─æiß╗âm | Quyß║┐t ─æß╗ïnh |
|---|---|---|---|
| **A. Wizard monitor: generate ΓåÆ preview ΓåÆ save ΓåÆ test job** | UX mß╗Öt luß╗ông; t├íi d├╣ng API | 2ΓÇô3 m├án modal | Γ£à |
| B. Chß╗ë deep-link sang Agent Editor | ├ìt code | Kh├┤ng "qua runner" nh╞░ y├¬u cß║ºu | Γ¥î |
| C. Runner tß╗▒ generate trong prompt | 1 job | Kh├│ preview/sß╗¡a draft tr╞░ß╗¢c khi l╞░u | Γ¥î |

### 3.3 Quick actions artifact

| Giß║úi ph├íp | ╞»u ─æiß╗âm | Nh╞░ß╗úc ─æiß╗âm | Quyß║┐t ─æß╗ïnh |
|---|---|---|---|
| **A. Config `artifact-actions.yaml` + job submit** | Declarative; mß╗ƒ rß╗Öng kh├┤ng sß╗¡a Vue | Cß║ºn schema mß╗¢i | Γ£à |
| B. Hardcode n├║t theo t├¬n file | Nhanh MVP | Kh├┤ng scalable | Γ¥î |
| C. Mß╗ƒ rß╗Öng `workflow-step-templates` | T├íi d├╣ng CRUD c├│ sß║╡n | Field thiß║┐u `agentRef`/artifact filter | D├╣ng l├ám base, extend schema |

## ┬º4. Implementation Details

### 4.1 Kiß║┐n tr├║c tß╗òng thß╗â

```mermaid
flowchart TB
  subgraph Monitor UI
    PV[PipelineView / PipelineNode]
    AP[ArtifactPanel + QuickActions]
    AW[AgentBuildWizard]
  end
  subgraph API
    TS[PUT /api/task-state]
    JOB[POST /api/jobs]
    GEN[POST /api/custom-agents/generate]
    AA[GET /api/artifact-actions]
  end
  subgraph Storage
    ST[.dev-state/id.json]
    CA[custom-agents/]
    AR[artifact-actions.yaml]
  end
  PV -->|approve/reject| TS
  TS --> ST
  AW --> GEN --> CA
  AW --> JOB
  AP --> AA
  AP --> JOB
  JOB --> Runner[jobQueue + provider]
```

### 4.2 Feature 1 ΓÇö Click icon flow ─æß╗â duyß╗çt HITL

#### Backend

**File mß╗¢i / sß╗¡a**

| File | Thay ─æß╗òi |
|---|---|
| `shared/schemas/task.ts` | Th├¬m `TaskStatePatch` schema: `action: 'approve' \| 'reject'`, `gate_id`, optional `feedback`, `mtime` |
| `server/tasks/state.ts` (mß╗¢i) | `readState`, `writeStateAtomic`, `applyHitlAction(state, pipeline, action)` |
| `server/http/routes/tasks.ts` | `PUT /api/task-state?id=<task-id>` |

**Logic `applyHitlAction` (approve)**

1. Validate `task.hitl_pending === gate_id` tß╗½ body (hoß║╖c derive tß╗½ pipeline step c├│ `hitl.gate_id`).
2. Load pipeline config (`loadPipelineConfig`).
3. T├¼m step hiß╗çn tß║íi c├│ `hitl.gate_id === hitl_pending`.
4. Approve:
   - `hitl_pending = null`
   - `current_phase = nextStep.id` (hoß║╖c `completed` nß║┐u step cuß╗æi)
   - Optional: set flag `dashboard_approved_at` trong state (passthrough field) cho audit.
5. Reject + feedback: giß╗» `current_phase`, `hitl_pending = null`, ghi `tasks/<id>/hitl-feedback.md` hoß║╖c append v├áo state `last_feedback` ΓÇö orchestrator resume sß║╜ ─æß╗ìc khi spawn lß║íi agent.

**Optimistic concurrency**: client gß╗¡i `mtime` tß╗½ `state_mtime` trong `/api/tasks`; conflict ΓåÆ 409 + state hiß╗çn tß║íi.

**Audit**: `emitAudit({ op: 'update', entity: 'task-state', identifier: id })`.

#### Frontend

| File | Thay ─æß╗òi |
|---|---|
| `PipelineNode.vue` | `@click` tr├¬n bubble khi `status === 'waiting'`; emit `hitl-action` |
| `PipelineView.vue` | Modal/popover: "Duyß╗çt phase X?", n├║t Duyß╗çt / Tß╗½ chß╗æi + textarea feedback; gß╗ìi `approveHitl()` |
| `src/api/client.ts` | `patchTaskState(taskId, body, projectId?)` |
| `MonitorLayout.vue` | Refresh poll sau approve; toast kß║┐t quß║ú |

**UX chi tiß║┐t**

- Icon `ΓÅ╕` (waiting) c├│ `cursor: pointer`, tooltip "Click ─æß╗â duyß╗çt".
- Sau approve: node chuyß╗ân `active`/`done`; badge header mß║Ñt `hitl_pending`.
- Nß║┐u step c├│ `optional_doc_review`: sau approve hiß╗çn dialog "Chß║íy doc-review?" (yes ΓåÆ submit job doc-reviewer ΓÇö phase 1b hoß║╖c defer).

#### Sync remote (Luß╗ông B)

Sau `PUT /api/task-state` th├ánh c├┤ng, nß║┐u project c├│ remote sync config ΓåÆ gß╗ìi nß╗Öi bß╗Ö helper (hoß║╖c document: user chß║íy sync) ΓÇö **kh├┤ng block** UI nß║┐u sync fail.

### 4.3 Feature 2 ΓÇö Build agent tß╗½ NL qua runner

#### Flow ng╞░ß╗¥i d├╣ng

1. N├║t **"Build agent"** tr├¬n monitor toolbar hoß║╖c runner panel (entry thß╗æng nhß║Ñt).
2. Modal wizard 3 b╞░ß╗¢c:
   - **M├┤ tß║ú** ΓåÆ `POST /api/custom-agents/generate`
   - **Preview draft** (name, skills, sections) ΓÇö chß╗ënh sß╗¡a inline
   - **L╞░u & chß║íy thß╗¡**: `POST /api/custom-agents` (save markdown) ΓåÆ `POST /api/jobs` vß╗¢i `agentRef: custom:<name>`, `userPrompt` smoke hoß║╖c task-specific
3. Chß╗ìn **runner** tß╗½ dropdown (`fetchRunners`).
4. Panel job status (poll `GET /api/jobs?id=`).

#### File

| File | Thay ─æß╗òi |
|---|---|
| `src/features/monitor/components/AgentBuildWizard.vue` (mß╗¢i) | Wizard compose generate + save + submit |
| `MonitorLayout.vue` hoß║╖c `App.vue` | N├║t mß╗ƒ wizard |
| `src/api/client.ts` | ─É├ú c├│ `generateAgentDraft`, `submitJob` ΓÇö bß╗ìc helper `buildAndRunAgent()` |

**Workspace job**: `tasks/<task-id>/` khi mß╗ƒ tß╗½ monitor context; hoß║╖c `custom-agents/` sandbox khi build ─æß╗Öc lß║¡p.

**Kh├┤ng bß║»t buß╗Öc** chß║íy implement phase ΓÇö wizard chß╗ë validate runner path.

### 4.4 Feature 3 ΓÇö Quick actions tr├¬n artifact viewer

#### Config schema

**File**: `.dev-team-agent/artifact-actions.yaml` (global, optional per-task override sau)

```yaml
version: 1
actions:
  - id: improve-doc
    label: "Γ£¿ Cß║úi thiß╗çn t├ái liß╗çu"
    artifact_patterns: ["investigate.md", "design.md", "review.md"]
    agent_ref: dev-agent-teams:doc-reviewer   # hoß║╖c custom agent
    prompt_template: |
      ─Éß╗ìc {{artifact_name}} v├á cß║úi thiß╗çn clarity, cß║Ñu tr├║c, tiß║┐ng Viß╗çt.
      Ghi ─æ├¿ c├╣ng file hoß║╖c tß║ío {{artifact_base}}-improved.md nß║┐u blocking.
    produces: []   # optional guard
    confirm: true
```

#### Backend

| File | Thay ─æß╗òi |
|---|---|
| `shared/schemas/artifactAction.ts` (mß╗¢i) | Zod schema |
| `server/artifactActions/index.ts` (mß╗¢i) | Load YAML safe; match pattern |
| `server/http/routes/tasks.ts` hoß║╖c `config.ts` | `GET /api/artifact-actions?artifact=design.md` |
| `server/http/routes/tasks.ts` | `POST /api/artifact-actions/run` ΓÇö body: `{ taskId, actionId, artifactName, runnerId? }` ΓåÆ build prompt tß╗½ template + ─æß╗ìc artifact ΓåÆ `submitJob` |

#### Frontend

| File | Thay ─æß╗òi |
|---|---|
| `ArtifactPanel.vue` | Toolbar: render n├║t tß╗½ `fetchArtifactActions(artifactName)`; loading state khi job chß║íy |
| `useArtifactAction.ts` (composable mß╗¢i) | submit ΓåÆ poll job ΓåÆ `fetchArtifact` reload |

**UX**: Sau job `succeeded`, auto reload artifact; nß║┐u `failed`, hiß╗çn link log (`job.logPath` qua API).

**V├¡ dß╗Ñ actions mß║╖c ─æß╗ïnh ship k├¿m**

| Action | Agent | Artifact |
|---|---|---|
| Cß║úi thiß╗çn t├ái liß╗çu | doc-reviewer hoß║╖c custom `doc-improver` | `*.md` trß╗½ `qa.md` |
| Chß║íy doc-review PO | doc-reviewer | investigate/design |
| T├│m tß║»t section | heuristic / lightweight custom | any |

### 4.5 Edge cases

| Case | Xß╗¡ l├╜ |
|---|---|
| Approve khi `hitl_pending` null | 400 ΓÇö kh├┤ng c├│ gate |
| Approve sai `gate_id` | 400 |
| State conflict (mtime) | 409 + refresh UI |
| Job runner disabled | Toast lß╗ùi; gß╗úi ├╜ cß║Ñu h├¼nh Runner mode |
| Artifact ─æang edit inline | Disable quick actions khi `isEditing()` |
| Task kh├┤ng c├│ state file | `PUT` tß║ío state tß╗æi thiß╗âu nß║┐u task dir tß╗ôn tß║íi |
| `blocking: true` gate (reviewer) | UI vß║½n cho approve; hiß╗ân thß╗ï cß║únh b├ío "gate bß║»t buß╗Öc human" |
| Remote + local orchestrator c├╣ng task | Document vß║¡n h├ánh: mß╗Öt runner active |

### 4.6 Phase 2 (out of immediate impl, design hook)

- `POST /api/task-state` approve ΓåÆ auto `submitJob` step kß║┐ theo pipeline config (dashboard-as-orchestrator-lite).
- WebSocket/SSE job progress thay v├¼ poll.
- Distributed lock `active_runner` trong state.

## ┬º5. Test Notes

### Backend (`bun test`)

- `applyHitlAction`: approve advances phase; reject keeps phase; invalid gate ΓåÆ error.
- `writeStateAtomic`: conflict mtime; corrupt JSON kh├┤ng crash.
- `artifact-actions`: pattern match; prompt substitution `{{artifact_name}}`.
- `POST /api/task-state` Hono golden snapshot.

### Frontend (`vitest`)

- `phaseStatus` unchanged regression.
- `PipelineNode` emit khi waiting.
- `useArtifactAction` poll mock.

### E2E (Playwright)

- Fixture task vß╗¢i `hitl_pending: hitl-1` ΓåÆ click node ΓåÆ approve ΓåÆ state cß║¡p nhß║¡t.
- Mß╗ƒ `investigate.md` ΓåÆ click "Cß║úi thiß╗çn" ΓåÆ job queued (mock runner hoß║╖c skip nß║┐u no CLI).
- Screenshot monitor vß╗¢i action bar ΓÇö attach playwright-report.

## ┬º6. Out of scope

- Sß╗¡a orchestrator plugin ─æß╗â auto-resume sau dashboard approve.
- SSH remote runner (Luß╗ông C) UI ─æß║╖c th├╣.
- Pipeline editor thay ─æß╗òi (chß╗ë monitor + artifact).
- Tß║ío custom agent ho├án to├án mß╗¢i ngo├ái NL wizard (─æ├ú c├│ Agent Editor).
- Ph├ón quyß╗ün multi-user tr├¬n HITL approve.

## ┬º7. Breakdown sub-issue (─æß╗Öc lß║¡p)

U0005 l├á epic. Mß╗ùi sub-issue l├á **vertical slice** (API + UI + test ri├¬ng), merge ─æ╞░ß╗úc mß╗Öt m├¼nh, kh├┤ng chß╗¥ sub kh├íc land tr╞░ß╗¢c ΓÇö trß╗½ optional phß╗Ñ thuß╗Öc ghi r├╡.

### Nguy├¬n tß║»c t├ích

| Nguy├¬n tß║»c | ├üp dß╗Ñng |
|---|---|
| Mß╗Öt PR = mß╗Öt user-facing outcome | Kh├┤ng t├ích ΓÇ£chß╗ë backendΓÇ¥ nß║┐u UI kh├┤ng ship c├╣ng |
| Kh├┤ng chia sß║╗ file n├│ng giß╗»a PR song song | Mß╗ùi sub sß╗ƒ hß╗»u file ch├¡nh; shared nhß╗Å copy tß║ím hoß║╖c extract sau |
| T├íi d├╣ng API ─æ├ú c├│ | `POST /api/jobs`, `POST /api/custom-agents/generate` kh├┤ng thuß╗Öc epic |
| Test nß║▒m trong tß╗½ng sub | Kh├┤ng c├│ sub ΓÇ£chß╗ë viß║┐t testΓÇ¥ |

### S╞í ─æß╗ô phß╗Ñ thuß╗Öc

```mermaid
flowchart LR
  U1[U0005-1 HITL approve]
  U2[U0005-2 Quick actions]
  U3[U0005-3 NL agent via runner]
  U4[U0005-4 Auto-advance sau approve]
  U1 -.->|optional| U4
  U2 -.- U3
```

`U0005-1`, `U0005-2`, `U0005-3` **song song ─æ╞░ß╗úc**. `U0005-4` chß╗ë sau `U0005-1`.

---

### U0005-1 ΓÇö Duyß╗çt HITL tr├¬n pipeline flow

**Outcome:** Click icon node `waiting` tr├¬n monitor ΓåÆ approve/reject ΓåÆ state cß║¡p nhß║¡t, poll UI phß║ún ├ính ngay.

| | |
|---|---|
| **Scope** | `PUT /api/task-state`, `server/tasks/state.ts`, schema patch, `PipelineNode` click, modal approve/reject + feedback, `patchTaskState` API client |
| **Kh├┤ng l├ám** | Auto-submit step kß║┐; doc-review auto; job runner |
| **File ch├¡nh** | `server/tasks/state.ts` (mß╗¢i), `server/http/routes/tasks.ts`, `shared/schemas/task.ts`, `PipelineNode.vue`, `PipelineView.vue`, `src/api/client.ts` |
| **Done khi** | Fixture `hitl_pending=hitl-1` ΓåÆ click ΓåÆ approve ΓåÆ `hitl_pending=null`, `current_phase` = step kß║┐; 409 khi mtime lß╗çch; unit + e2e screenshot monitor |
| **╞»ß╗¢c t├¡nh** | 1ΓÇô2 ng├áy |
| **─Éß╗Öc lß║¡p** | Γ£à Kh├┤ng phß╗Ñ thuß╗Öc U0005-2/3 |

---

### U0005-2 ΓÇö Quick actions tr├¬n artifact viewer

**Outcome:** Mß╗ƒ artifact ΓåÆ toolbar hiß╗çn n├║t (vd. ΓÇ£Cß║úi thiß╗çn t├ái liß╗çuΓÇ¥) ΓåÆ submit job agent ΓåÆ reload artifact khi job xong.

| | |
|---|---|
| **Scope** | `artifact-actions.yaml` + Zod schema, `GET /api/artifact-actions`, `POST /api/artifact-actions/run`, toolbar `ArtifactPanel`, composable poll job + reload |
| **Kh├┤ng l├ám** | HITL; NL wizard; tß║ío agent mß╗¢i |
| **File ch├¡nh** | `server/artifactActions/` (mß╗¢i), `shared/schemas/artifactAction.ts`, routes tasks/config, `ArtifactPanel.vue`, `useArtifactAction.ts` (mß╗¢i) |
| **Done khi** | Seed action `improve-doc` match `investigate.md`/`design.md`; click ΓåÆ job queued; poll succeeded ΓåÆ content reload; fail ΓåÆ hiß╗çn lß╗ùi; unit pattern/prompt + e2e (job mock nß║┐u kh├┤ng c├│ CLI) |
| **╞»ß╗¢c t├¡nh** | 1ΓÇô2 ng├áy |
| **─Éß╗Öc lß║¡p** | Γ£à Chß╗ë cß║ºn `POST /api/jobs` ─æ├ú c├│ |

**Ghi ch├║:** Poll job c├│ thß╗â inline trong composable; kh├┤ng bß║»t buß╗Öc extract shared vß╗¢i U0005-3.

---

### U0005-3 ΓÇö Build agent tß╗½ NL qua runner

**Outcome:** Tß╗½ monitor (hoß║╖c entry r├╡ tr├¬n UI) mß╗ƒ wizard: m├┤ tß║ú NL ΓåÆ preview draft ΓåÆ l╞░u custom agent ΓåÆ chß╗ìn runner ΓåÆ chß║íy thß╗¡ job.

| | |
|---|---|
| **Scope** | `AgentBuildWizard.vue`, wire `generate` + save custom-agent + `submitJob`, chß╗ìn runner, hiß╗ân thß╗ï job status |
| **Kh├┤ng l├ám** | Sß╗¡a generate backend (─æ├ú c├│); HITL; artifact-actions config |
| **File ch├¡nh** | `src/features/monitor/components/AgentBuildWizard.vue` (mß╗¢i), `MonitorLayout.vue` (n├║t mß╗ƒ), t├íi d├╣ng API client hiß╗çn c├│ |
| **Done khi** | Generate draft (heuristic hoß║╖c API key); save agent; smoke job qua runner default; lß╗ùi runner disabled c├│ message r├╡ |
| **╞»ß╗¢c t├¡nh** | 1 ng├áy |
| **─Éß╗Öc lß║¡p** | Γ£à Chß╗ë cß║ºn generate + jobs API ─æ├ú c├│ |

---

### U0005-4 ΓÇö (Optional) Auto-advance pipeline sau approve

**Outcome:** Sau approve HITL, dashboard tß╗▒ `submitJob` agent cß╗ºa step kß║┐ (dashboard-as-orchestrator-lite).

| | |
|---|---|
| **Scope** | Hook sau `applyHitlAction` approve; resolve `step.agent` + prompt template tß╗æi thiß╗âu; submit job; ghi metadata job v├áo state |
| **Phß╗Ñ thuß╗Öc** | **U0005-1** (bß║»t buß╗Öc) |
| **Kh├┤ng l├ám** | Full orchestrator (retry, doc-review loop, Q&A HITL phß╗⌐c tß║íp) |
| **Done khi** | Approve investigator gate ΓåÆ job designer queued (khi runner sß║╡n s├áng) |
| **╞»ß╗¢c t├¡nh** | 1 ng├áy |
| **─Éß╗Öc lß║¡p** | Γ¥î Sau U0005-1 |

---

### Kh├┤ng t├ích th├ánh sub ri├¬ng

| Viß╗çc | L├╜ do |
|---|---|
| ΓÇ£Chß╗ë viß║┐t test / e2eΓÇ¥ | Gß║»n v├áo tß╗½ng U0005-1/2/3 |
| Remote sync / `orchestrator-remote.json` | Vß║¡n h├ánh ─æ├ú xong, kh├┤ng phß║úi feature code |
| Shared `useJobPoll` extract | L├ám trong PR thß╗⌐ hai nß║┐u tr├╣ng code; kh├┤ng block |
| SSE/WebSocket job progress | Out of scope epic; follow-up ri├¬ng |

### Thß╗⌐ tß╗▒ ╞░u ti├¬n (khi kh├┤ng chß║íy song song)

1. **U0005-1** ΓÇö unblock HITL tr├¬n dashboard (gi├í trß╗ï vß║¡n h├ánh cao nhß║Ñt)
2. **U0005-2** ΓÇö quick actions (d├╣ng h├áng ng├áy khi ─æß╗ìc doc)
3. **U0005-3** ΓÇö NL wizard (├¡t cß║Ñp b├ích h╞ín, Agent Editor ─æ├ú c├│ generate mß╗Öt phß║ºn)
4. **U0005-4** ΓÇö chß╗ë khi cß║ºn pipeline tß╗▒ chß║íy sau approve

### C├ích mß╗ƒ subtask orchestrator

```text
/dev-team-orchestrator U0005-1 --subtask-of=U0005 --remote
/dev-team-orchestrator U0005-2 --subtask-of=U0005 --remote
/dev-team-orchestrator U0005-3 --subtask-of=U0005 --remote
```

Mß╗ùi sub kß║┐ thß╗½a `investigate.md` / `design.md` parent; implementer chß╗ë l├ám scope sub ─æ├│. Parent U0005 ─æ├│ng khi 1ΓÇô3 done (4 optional).

---

## Phß╗Ñ lß╗Ñc: Mapping file dß╗▒ kiß║┐n

| Tr╞░ß╗¢c | Sau |
|---|---|
| ΓÇö | `server/tasks/state.ts` |
| ΓÇö | `server/artifactActions/index.ts` |
| ΓÇö | `shared/schemas/artifactAction.ts` |
| ΓÇö | `.dev-team-agent/artifact-actions.yaml` (default seed) |
| `server/http/routes/tasks.ts` | + `PUT /api/task-state`, `GET/POST artifact-actions` |
| `PipelineNode.vue` | + click HITL |
| `PipelineView.vue` | + approve modal |
| `ArtifactPanel.vue` | + quick action bar |
| ΓÇö | `AgentBuildWizard.vue`, `useArtifactAction.ts` |
| `src/api/client.ts` | + wrappers |
