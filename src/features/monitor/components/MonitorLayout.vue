<script setup lang="ts">
import ProjectBar from './ProjectBar.vue'
import TaskList from './TaskList.vue'
import PipelineView from './PipelineView.vue'
import QaPanel from './QaPanel.vue'
import ArtifactPanel from './ArtifactPanel.vue'

defineProps({
  projects: { type: Array, default: () => [] },
  defaultProjectId: { type: [String, null], default: null },
  selectedProjectId: { type: [String, null], default: null },
  tasks: { type: Array, default: () => [] },
  selectedId: { type: [String, null], default: null },
  selected: { type: Object, default: null },
  openArtifact: { type: Object, default: null },
  connected: { type: Boolean, default: false },
  error: { type: String, default: '' },
  lastUpdated: { type: String, default: '' },
})

const emit = defineEmits(['select-project', 'projects-changed', 'select-task', 'open-artifact', 'qa-saved'])
</script>

<template>
  <div class="monitor-layout">
    <aside class="monitor-sub-sidebar">
      <ProjectBar
        :projects="projects"
        :default-id="defaultProjectId"
        :selected-id="selectedProjectId"
        @select="emit('select-project', $event)"
        @changed="emit('projects-changed')"
      />
      <TaskList
        :tasks="tasks"
        :selected-id="selectedId"
        :open-artifact="openArtifact"
        @select="emit('select-task', $event)"
        @open-artifact="emit('open-artifact', $event)"
      />
    </aside>
    <section class="monitor-content">
      <template v-if="selected">
        <div class="task-head">
          <h2>
            {{ selected.task_id }}
            <span v-if="selected.parent_task_id" class="subtask">↳ subtask của {{ selected.parent_task_id }}</span>
          </h2>
          <div class="badges">
            <span v-if="selected.auto_review" class="badge auto">auto-review</span>
            <span v-if="selected.review_round" class="badge">review round {{ selected.review_round }}/2</span>
            <span v-if="selected.hitl_pending" class="badge hitl">⏸ {{ selected.hitl_pending }}</span>
            <span v-if="!selected.state_ok" class="badge err">state lỗi</span>
          </div>
        </div>

        <QaPanel
          v-if="selected.has_qa"
          :qa="selected.qa"
          :task-id="selected.task_id"
          :project-id="selectedProjectId"
          @saved="emit('qa-saved')"
        />

        <PipelineView :task="selected" />

        <ArtifactPanel
          :task="selected"
          :project-id="selectedProjectId"
          :open-artifact="openArtifact && openArtifact.taskId === selected.task_id ? openArtifact : null"
        />
      </template>
      <div v-else class="empty">
        <p v-if="!tasks.length && connected">
          Chưa có task nào trong <code>.dev-team-agent/.dev-state/</code>.<br />
          Chạy <code>/dev-team-orchestrator &lt;task-id&gt;</code> để bắt đầu.
        </p>
        <p v-else-if="!connected">Đang kết nối tới dev server…</p>
        <p v-else>Chọn một task ở bên trái.</p>
      </div>
    </section>
  </div>
</template>
