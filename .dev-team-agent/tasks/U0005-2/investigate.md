# Investigation ΓÇö U0005: T├¡ch hß╗úp agent v├áo pipeline dashboard

## 1. Mß╗Ñc ti├¬u

Cho ph├⌐p ng╞░ß╗¥i d├╣ng t╞░╞íng t├íc vß╗¢i pipeline dev-team **trß╗▒c tiß║┐p tr├¬n dashboard** thay v├¼ chß╗ë qua orchestrator CLI/chat:

1. **HITL tr├¬n flow monitor** ΓÇö click icon node pipeline ─æß╗â duyß╗çt gate.
2. **Build agent tß╗½ NL qua runner** ΓÇö m├┤ tß║ú tß╗▒ nhi├¬n ΓåÆ draft agent ΓåÆ chß║íy thß╗¡ / l╞░u qua job queue.
3. **Quick actions tr├¬n artifact viewer** ΓÇö n├║t mß╗Öt-click k├¡ch hoß║ít agent (vd. cß║úi thiß╗çn t├ái liß╗çu).

## 2. Hiß╗çn trß║íng codebase

### 2.1 Monitor + pipeline flow

| Th├ánh phß║ºn | Vai tr├▓ | Gap |
|---|---|---|
| `PipelineView.vue` | VueFlow render node theo `phasesFromPipeline(task.pipeline)` | Chß╗ë hiß╗ân thß╗ï; kh├┤ng c├│ click handler tr├¬n node/icon |
| `PipelineNode.vue` | Bubble icon theo `status` (`done/active/waiting/pending`) | Kh├┤ng emit event; kh├┤ng n├║t approve |
| `phaseStatus()` (`src/api/phase.ts`) | `waiting` khi `task.hitl_pending === phase.hitl` | Logic ─æ├║ng nh╞░ng **read-only** |
| `MonitorLayout.vue` | Badge `hitl_pending` tr├¬n header | Kh├┤ng c├│ UI duyß╗çt |

**State contract**: `.dev-state/<id>.json` do orchestrator ghi; dashboard **chß╗ë ─æß╗ìc** (`shared/schemas/task.ts` comment, `server/tasks/index.ts`).

ΓåÆ **Kh├┤ng c├│** `PUT /api/task-state` hay t╞░╞íng ─æ╞░╞íng. Feature (1) bß║»t buß╗Öc th├¬m API ghi state an to├án.

### 2.2 Runner + job queue

| Th├ánh phß║ºn | Vai tr├▓ | Gap |
|---|---|---|
| `POST /api/jobs` (`runners.ts`) | `submitJob({ agentRef, workspace, userPrompt, ... })` | ─É├ú c├│; workspace resolve tß╗½ `.dev-team-agent/` |
| `RunnerConfigPanel.vue` | Smoke test vß╗¢i `agentRef` + `userPrompt` cß╗æ ─æß╗ïnh | Chß╗ë trong mode Runner; kh├┤ng gß║»n pipeline/monitor |
| `POST /api/custom-agents/generate` | NL ΓåÆ `AgentDraft` (API hoß║╖c heuristic) | Chß╗ë trong Agent Editor (`AgentNlWizard.vue`) |
| `agentResolver.ts` | Resolve `dev-agent-teams:*` v├á custom agent file | Sß║╡n s├áng cho job |

ΓåÆ Job infrastructure **─æß╗º** cho (2) v├á (3); thiß║┐u **UI entry point** v├á flow kß║┐t nß╗æi NL ΓåÆ draft ΓåÆ save ΓåÆ run.

### 2.3 Artifact viewer

| Th├ánh phß║ºn | Vai tr├▓ | Gap |
|---|---|---|
| `ArtifactPanel.vue` | ─Éß╗ìc/ghi artifact qua `PUT /api/artifact` | Toolbar chß╗ë c├│ Full/Blocks toggle |
| `workflow-step-templates` | JSON template (`name`, `title`, `body`, `pipeline_step_id`) | D├╣ng cho pipeline editor builder; **ch╞░a** expose l├ám quick action tr├¬n monitor |

ΓåÆ Feature (3) c├│ thß╗â t├íi sß╗¡ dß╗Ñng `workflow-step-templates` hoß║╖c catalog mß╗¢i `artifact-actions`.

### 2.4 Orchestrator Γåö dashboard

- Orchestrator (`dev-team-orchestrator` skill) ghi `hitl_pending`, spawn agent qua `remote-runner-cli.mjs` / Task tool.
- Dashboard remote mode (Luß╗ông B): sync git sau state/step ΓÇö **dashboard kh├┤ng ─æß║⌐y pipeline tiß║┐p** khi user approve.
- Sau khi dashboard ghi state (approve), orchestrator `--resume` hoß║╖c runner submit step kß║┐ mß╗¢i chß║íy phase tiß║┐p.

**Blast radius**: Thay ─æß╗òi chß╗º yß║┐u `server/http/routes/tasks.ts`, `server/tasks/`, `src/features/monitor/`, `src/api/`, schema Zod, tests mirror. Kh├┤ng ─æß╗Ñng orchestrator plugin trß╗½ khi muß╗æn dashboard-triggered resume tß╗▒ ─æß╗Öng.

## 3. Call chain hiß╗çn tß║íi

### HITL (orchestrator-only)

```
orchestrator ΓåÆ ghi state (hitl_pending=gate_id)
            ΓåÆ user g├╡ "approved" trong chat
            ΓåÆ orchestrator clear hitl_pending, next step
```

Dashboard chß╗ë poll `GET /api/tasks` ΓåÆ hiß╗ân thß╗ï `waiting` tr├¬n node.

### Chß║íy agent (runner mode)

```
RunnerConfigPanel ΓåÆ POST /api/jobs ΓåÆ jobQueue ΓåÆ claude-code-cli provider
                ΓåÆ resolveAgent(agentRef) ΓåÆ execute ΓåÆ log
```

### NL agent draft

```
AgentNlWizard ΓåÆ POST /api/custom-agents/generate ΓåÆ draft
             ΓåÆ user save trong Agent Editor (kh├┤ng qua runner)
```

## 4. Gap tß╗òng hß╗úp

| # | Y├¬u cß║ºu | C├│ sß║╡n | Thiß║┐u |
|---|---|---|---|
| 1 | Click icon flow ─æß╗â duyß╗çt | Hiß╗ân thß╗ï status + gate label tr├¬n edge | API ghi state; UI approve/reject; optional doc-review prompt; sync git (remote) |
| 2 | Build agent tß╗½ NL qua runner | generate API + submit job | Wizard trong monitor/runner; persist custom agent; chß╗ìn runner; theo d├╡i job |
| 3 | Quick actions tr├¬n artifact | submit job API; workflow templates (builder) | Action bar theo artifact type; prompt template; poll job + reload artifact |

## 5. Rß╗ºi ro & r├áng buß╗Öc

- **Conflict state**: Dashboard ghi `hitl_pending` trong khi orchestrator CLI c┼⌐ng chß║íy c├╣ng task ΓåÆ last-write-wins (skill ghi r├╡ MVP kh├┤ng c├│ lock).
- **Atomic write**: State file phß║úi ghi temp + rename (giß╗æng `saveRegistry`, `PUT /api/artifact`).
- **Path hardening**: Task id regex, sanitize mß╗ìi input.
- **Kh├┤ng ph├í read-only invariant** cho artifact state read ΓÇö chß╗ë th├¬m endpoint state ri├¬ng, c├│ audit log.
- Remote `--remote`: cß║ºn `orchestrator-remote.json` hoß║╖c env `DEV_TEAM_*` ΓÇö **ch╞░a cß║Ñu h├¼nh** trong repo hiß╗çn tß║íi; sync sau approve l├á best-effort.

## 6. Phß╗Ñ thuß╗Öc li├¬n quan

- Issue F0003 / agent-workflow#39: remote dashboard, `dashboard-sync.mjs`.
- `workflow-step-templates` c├│ thß╗â mß╗ƒ rß╗Öng th├ánh `artifact-quick-actions` vß╗¢i field `agentRef`, `produces`, `prompt_template`.

## 7. Kß║┐t luß║¡n ─æiß╗üu tra

Ba t├¡nh n─âng **khß║ú thi tr├¬n nß╗ün dashboard hiß╗çn tß║íi** vß╗¢i phß║ím vi tß║¡p trung:

1. **Backend state mutation API** + frontend HITL tr├¬n `PipelineNode`.
2. **Compose flow** generate ΓåÆ save custom agent ΓåÆ submit job (t├íi d├╣ng runner).
3. **Artifact toolbar actions** map tß╗¢i job submit + artifact reload.

Kh├┤ng cß║ºn thay ─æß╗òi orchestrator plugin ß╗ƒ phase 1; dashboard ─æ├│ng vai tr├▓ **HITL surface** v├á **agent launcher**. Orchestrator `--resume` hoß║╖c auto-submit step kß║┐ l├á phase 2 t├╣y chß╗ìn.
