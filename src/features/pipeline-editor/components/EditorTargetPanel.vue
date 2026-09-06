<script setup lang="ts">
/**
 * Đầu sub-sidebar của Pipeline Editor: chọn **đối tượng đang sửa** (profile ở tab
 * Profile, task ở tab Task) và cụm nút action.
 *
 * Thuần trình bày — không gọi API, không đụng canvas. Mọi thao tác đi ra ngoài
 * bằng emit để `PipelineEditor` giữ nguyên vai trò nơi duy nhất nạp/ghi pipeline.
 */
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed } from 'vue'
import Icon from '../../../core/ui/Icon.vue'
import RailIcon from '../../../core/ui/RailIcon.vue'
import { taskDisplayName } from '../../monitor/lib/taskDisplay'

const { t } = useI18nHelpers()

const props = defineProps({
  tab: { type: String, default: 'profile' }, // 'profile' | 'task'
  collapsed: { type: Boolean, default: false },
  /** Danh sách profile của project đang chọn (`[{ name }]`). */
  profiles: { type: Array as () => any[], default: () => [] },
  /** Profile đang chọn ở tab Profile — nguồn của auto-load. */
  profileSelected: { type: String, default: '' },
  /** Tên sẽ ghi khi bấm Save ở tab Profile (khởi tạo theo `profileSelected`). */
  profileName: { type: String, default: '' },
  /** Profile được nạp làm bản nháp cho task — không auto-submit. */
  taskProfile: { type: String, default: '' },
  tasks: { type: Array as () => any[], default: () => [] },
  taskSelect: { type: String, default: '' },
  taskManual: { type: String, default: '' },
  saving: { type: Boolean, default: false },
  previewing: { type: Boolean, default: false },
  saveDisabled: { type: Boolean, default: false },
  setDefaultDisabled: { type: Boolean, default: false },
  message: { type: String, default: '' },
  warning: { type: String, default: '' },
})

const emit = defineEmits([
  'update:profileSelected',
  'update:profileName',
  'update:taskProfile',
  'update:taskSelect',
  'update:taskManual',
  'save',
  'delete-profile',
  'set-default',
  'auto-layout',
  'preview',
  'stop',
  'open-section',
])

const isProfileTab = computed(() => props.tab === 'profile')

function onSelectInput(event: Event, name: string) {
  emit(name as any, (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="editor-target-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- Thu gọn: chỉ dải icon dọc. Action giữ nguyên (kể cả Stop khi preview) -->
    <template v-if="collapsed">
      <div class="target-actions target-actions--rail">
        <button
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.saveTitle')"
          :aria-label="t('pipelineEditor.target.save')"
          :disabled="saving || saveDisabled"
          @click="emit('save')"
        >
          <Icon name="save" />
        </button>
        <button
          v-if="isProfileTab"
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.setDefaultTitle')"
          :aria-label="t('pipelineEditor.target.setDefault')"
          :disabled="setDefaultDisabled"
          @click="emit('set-default')"
        >
          <Icon name="star" />
        </button>
        <button
          v-if="isProfileTab"
          type="button"
          class="icon-btn danger"
          :title="t('pipelineEditor.target.deleteProfile')"
          :aria-label="t('pipelineEditor.target.deleteProfile')"
          :disabled="!profileSelected"
          @click="emit('delete-profile')"
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.autoLayout')"
          :aria-label="t('pipelineEditor.target.autoLayout')"
          @click="emit('auto-layout')"
        >
          <Icon name="layout" />
        </button>
        <button
          v-if="!previewing"
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.preview')"
          :aria-label="t('pipelineEditor.target.preview')"
          @click="emit('preview')"
        >
          <Icon name="play" />
        </button>
        <button
          v-else
          type="button"
          class="icon-btn danger"
          :title="t('pipelineEditor.target.stop')"
          :aria-label="t('pipelineEditor.target.stop')"
          @click="emit('stop')"
        >
          <Icon name="stop" />
        </button>
      </div>
      <div class="target-sections-rail">
        <button
          type="button"
          class="rail-icon-btn target-section-icon"
          :title="t('pipelineEditor.sections.agentsOpenTitle')"
          :aria-label="t('pipelineEditor.sections.agentsOpenTitle')"
          @click="emit('open-section', 'agents')"
        >
          <RailIcon name="catalog" />
        </button>
        <button
          type="button"
          class="rail-icon-btn target-section-icon"
          :title="t('pipelineEditor.sections.rulesOpenTitle')"
          :aria-label="t('pipelineEditor.sections.rulesOpenTitle')"
          @click="emit('open-section', 'rules')"
        >
          <RailIcon name="rules" />
        </button>
      </div>
    </template>

    <template v-else>
      <!-- 1.1 — select đối tượng: profile ở tab Profile, task ở tab Task -->
      <template v-if="isProfileTab">
        <label class="target-label" for="editor-target-profile">
          {{ t('pipelineEditor.target.profileLabel') }}
        </label>
        <select
          id="editor-target-profile"
          class="target-select cfg-input"
          :value="profileSelected"
          @change="onSelectInput($event, 'update:profileSelected')"
        >
          <option value="">{{ t('pipelineEditor.target.selectProfile') }}</option>
          <option v-for="p in profiles" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <input
          class="target-input cfg-input"
          :value="profileName"
          :placeholder="t('pipelineEditor.target.saveAsPlaceholder')"
          :aria-label="t('pipelineEditor.target.saveAsPlaceholder')"
          @input="emit('update:profileName', ($event.target as HTMLInputElement).value)"
          @keydown.enter="emit('save')"
        />
      </template>

      <template v-else>
        <label class="target-label" for="editor-target-task">
          {{ t('pipelineEditor.target.taskLabel') }}
        </label>
        <select
          id="editor-target-task"
          class="target-select cfg-input"
          :value="taskSelect"
          @change="onSelectInput($event, 'update:taskSelect')"
        >
          <option value="">{{ t('pipelineEditor.scope.selectTask') }}</option>
          <option v-for="task in tasks" :key="task.task_id" :value="task.task_id">
            {{ taskDisplayName(task) }}
          </option>
          <option value="__manual__">{{ t('pipelineEditor.scope.manualEntry') }}</option>
        </select>
        <input
          v-if="taskSelect === '__manual__'"
          class="target-input cfg-input"
          :value="taskManual"
          :placeholder="t('pipelineEditor.scope.taskIdPlaceholder')"
          :aria-label="t('pipelineEditor.scope.taskIdPlaceholder')"
          @input="emit('update:taskManual', ($event.target as HTMLInputElement).value)"
        />

        <!-- b.1 — đổi profile chỉ nạp bản nháp lên canvas, phải bấm Save mới ghi -->
        <label class="target-label" for="editor-target-task-profile">
          {{ t('pipelineEditor.target.taskProfileLabel') }}
        </label>
        <select
          id="editor-target-task-profile"
          class="target-select cfg-input"
          :value="taskProfile"
          @change="onSelectInput($event, 'update:taskProfile')"
        >
          <option value="">{{ t('pipelineEditor.target.taskProfileNone') }}</option>
          <option v-for="p in profiles" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
      </template>

      <!-- 1.2 + 1.3 — một nút Save duy nhất, cụm action nằm hẳn trong sub-sidebar -->
      <div class="target-actions">
        <button
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.saveTitle')"
          :aria-label="t('pipelineEditor.target.save')"
          :disabled="saving || saveDisabled"
          @click="emit('save')"
        >
          <Icon name="save" />
        </button>
        <button
          v-if="isProfileTab"
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.setDefaultTitle')"
          :aria-label="t('pipelineEditor.target.setDefault')"
          :disabled="setDefaultDisabled"
          @click="emit('set-default')"
        >
          <Icon name="star" />
        </button>
        <button
          v-if="isProfileTab"
          type="button"
          class="icon-btn danger"
          :title="t('pipelineEditor.target.deleteProfile')"
          :aria-label="t('pipelineEditor.target.deleteProfile')"
          :disabled="!profileSelected"
          @click="emit('delete-profile')"
        >
          <Icon name="trash" />
        </button>
        <button
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.autoLayout')"
          :aria-label="t('pipelineEditor.target.autoLayout')"
          @click="emit('auto-layout')"
        >
          <Icon name="layout" />
        </button>
        <button
          v-if="!previewing"
          type="button"
          class="icon-btn"
          :title="t('pipelineEditor.target.preview')"
          :aria-label="t('pipelineEditor.target.preview')"
          @click="emit('preview')"
        >
          <Icon name="play" />
        </button>
        <button
          v-else
          type="button"
          class="icon-btn danger"
          :title="t('pipelineEditor.target.stop')"
          :aria-label="t('pipelineEditor.target.stop')"
          @click="emit('stop')"
        >
          <Icon name="stop" />
        </button>
      </div>

      <div v-if="saving" class="target-msg">{{ t('pipelineEditor.target.saving') }}</div>
      <div v-else-if="message" class="target-msg">{{ message }}</div>
      <div v-if="warning" class="target-warning" role="status">{{ warning }}</div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.editor-target-panel {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.editor-target-panel.is-collapsed {
  align-items: center;
  gap: 10px;
  padding: 6px;
}

.target-label { font-size: 11px; color: var(--muted); }

.target-select,
.target-input {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
  outline: none;
}
.target-input:focus,
.target-select:focus { border-color: var(--accent); }

.target-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.target-actions--rail {
  flex-direction: column;
  gap: 4px;
  margin-top: 0;
  flex-wrap: nowrap;
}

.target-sections-rail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  width: 100%;
  align-items: center;
}
.target-section-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  padding: 0;
  cursor: pointer;
}
.target-section-icon:hover { color: var(--accent); border-color: var(--accent); }

.target-msg { font-size: 11px; color: var(--muted); word-break: break-word; }
.target-warning {
  font-size: 11px;
  line-height: 1.35;
  color: var(--waiting, #b8860b);
  background: rgba(184, 134, 11, 0.12);
  border: 1px solid rgba(184, 134, 11, 0.35);
  border-radius: 4px;
  padding: 4px 6px;
}
</style>
