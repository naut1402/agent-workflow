<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAgentBuild } from '../composables/useAgentBuild'

const props = defineProps<{
  projectId: string | null
  // When opened from a task, the smoke job runs in that task's workspace.
  taskId?: string | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

// Task dir when opened from a task context, else a standalone sandbox.
const workspace = computed(() => (props.taskId ? `tasks/${props.taskId}` : 'custom-agents'))

const build = useAgentBuild({
  getProjectId: () => props.projectId,
  getWorkspace: () => workspace.value,
})

onMounted(() => {
  build.loadRunners()
})

// Skills are edited as a comma/newline separated string then normalised back to
// the draft array so the persisted agent keeps its structured shape.
const skillsText = computed<string>({
  get: () => (build.draft.value?.skills ?? []).join(', '),
  set: (v: string) => {
    if (!build.draft.value) return
    build.draft.value.skills = v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  },
})

const jobBadge = computed(() => {
  const s = build.jobStatus.value
  if (!s) return { label: 'đang khởi tạo…', cls: 'pending' }
  if (s === 'succeeded') return { label: 'thành công', cls: 'ok' }
  if (s === 'failed' || s === 'cancelled') return { label: s, cls: 'err' }
  return { label: s, cls: 'pending' }
})

function close() {
  if (build.running.value) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="close">
      <div class="modal agent-build-wizard">
        <div class="modal-head">
          <span>Build agent từ mô tả</span>
          <button class="modal-close" @click="close">✕</button>
        </div>

        <!-- Step indicator -->
        <ol class="wizard-steps">
          <li :class="{ current: build.step.value === 'describe', done: build.step.value !== 'describe' }">1. Mô tả</li>
          <li :class="{ current: build.step.value === 'preview', done: build.step.value === 'run' }">2. Xem lại draft</li>
          <li :class="{ current: build.step.value === 'run' }">3. Lưu &amp; chạy thử</li>
        </ol>

        <!-- Step 1: describe -->
        <section v-if="build.step.value === 'describe'" class="wizard-body">
          <p class="modal-hint">
            Mô tả agent bằng tiếng Việt/Anh. Hệ thống tạo draft (heuristic, hoặc gọi API nếu có
            <code>ANTHROPIC_API_KEY</code>).
          </p>
          <textarea
            v-model="build.description.value"
            class="profile-editor"
            rows="6"
            placeholder="Ví dụ: Agent review code PHP theo coding conventions, kiểm tra bảo mật SQL/XSS…"
          />
          <p v-if="build.error.value" class="editor-error">{{ build.error.value }}</p>
          <div class="modal-actions">
            <button class="btn-ghost" @click="close">Hủy</button>
            <button class="btn-primary" :disabled="build.generating.value" @click="build.generate()">
              {{ build.generating.value ? 'Đang tạo…' : 'Tạo draft →' }}
            </button>
          </div>
        </section>

        <!-- Step 2: preview & edit -->
        <section v-else-if="build.step.value === 'preview' && build.draft.value" class="wizard-body">
          <p class="modal-hint">Kiểm tra và chỉnh sửa draft trước khi lưu.</p>
          <label class="field">
            <span>Tên agent</span>
            <input v-model="build.draft.value.name" class="field-input" type="text" placeholder="ten-agent" />
          </label>
          <label class="field">
            <span>Mô tả</span>
            <input v-model="build.draft.value.description" class="field-input" type="text" />
          </label>
          <label class="field">
            <span>Skills (phân tách bằng dấu phẩy)</span>
            <input v-model="skillsText" class="field-input" type="text" placeholder="run-phpstan, coding-rules" />
          </label>
          <details v-if="build.draft.value.sections" class="sections-preview">
            <summary>Sections ({{ Object.keys(build.draft.value.sections).length }})</summary>
            <div v-for="(content, key) in build.draft.value.sections" :key="key" class="section-block">
              <strong>{{ key }}</strong>
              <pre>{{ content || '—' }}</pre>
            </div>
          </details>

          <label class="field">
            <span>Runner</span>
            <select v-model="build.selectedRunnerId.value" class="field-input">
              <option v-if="!build.usableRunners.value.length" :value="null" disabled>
                (chưa có runner khả dụng)
              </option>
              <option v-for="r in build.usableRunners.value" :key="r.id" :value="r.id">
                {{ r.name || r.id }}
              </option>
            </select>
          </label>
          <p v-if="!build.hasUsableRunner.value" class="editor-error">
            Chưa có runner khả dụng. Hãy bật hoặc cấu hình một runner ở tab Runner rồi thử lại.
          </p>
          <p class="modal-hint">Workspace chạy thử: <code>{{ workspace }}</code></p>

          <p v-if="build.error.value" class="editor-error">{{ build.error.value }}</p>
          <div class="modal-actions">
            <button class="btn-ghost" @click="build.backToDescribe()">← Quay lại</button>
            <button
              class="btn-primary"
              :disabled="build.running.value || !build.hasUsableRunner.value"
              @click="build.buildAndRun()"
            >
              Lưu &amp; chạy thử →
            </button>
          </div>
        </section>

        <!-- Step 3: run status -->
        <section v-else-if="build.step.value === 'run'" class="wizard-body">
          <p class="modal-hint">
            Agent <strong>{{ build.savedName.value || build.draft.value?.name }}</strong> —
            <span class="job-badge" :class="jobBadge.cls">{{ jobBadge.label }}</span>
          </p>
          <p v-if="build.jobId.value" class="muted">Job: <code>{{ build.jobId.value }}</code></p>
          <p v-if="build.running.value" class="muted">Đang chờ runner hoàn tất…</p>
          <p v-if="build.jobError.value" class="editor-error">{{ build.jobError.value }}</p>
          <p v-if="build.jobLogPath.value" class="muted">Log: <code>{{ build.jobLogPath.value }}</code></p>
          <p v-if="build.jobStatus.value === 'succeeded'" class="chip chip-ok">
            Agent đã lưu và chạy thử thành công.
          </p>
          <div class="modal-actions">
            <button class="btn-ghost" :disabled="build.running.value" @click="build.backToPreview()">
              ← Sửa draft
            </button>
            <button class="btn-primary" :disabled="build.running.value" @click="close">Đóng</button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wizard-steps {
  display: flex;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
}
.wizard-steps li {
  flex: 1;
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: var(--panel, #1e2028);
  color: var(--muted, #8b8f9a);
  text-align: center;
}
.wizard-steps li.current {
  color: var(--fg, #e6e6e6);
  font-weight: 600;
  outline: 1px solid var(--accent, #6ea8fe);
}
.wizard-steps li.done {
  color: var(--ok, #4caf50);
}
.wizard-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}
.field-input {
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  background: var(--panel, #15171d);
  color: inherit;
}
.sections-preview {
  font-size: 0.8rem;
}
.section-block pre {
  white-space: pre-wrap;
  max-height: 8rem;
  overflow: auto;
  background: var(--panel, #15171d);
  padding: 0.4rem;
  border-radius: 4px;
}
.job-badge {
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
}
.job-badge.ok { color: var(--ok, #4caf50); }
.job-badge.err { color: var(--err, #e5484d); }
.job-badge.pending { color: var(--waiting, #d0a215); }
</style>
