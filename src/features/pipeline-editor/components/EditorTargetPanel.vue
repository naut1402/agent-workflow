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
import CSelect from '../../../core/ui/CSelect.vue'
import type { CSelectOption } from '../../../core/ui/CSelect.vue'
import RailIcon from '../../../core/ui/RailIcon.vue'
import type { RailIconName } from '../../../core/ui/railIconNames'
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

const profileOptions = computed<CSelectOption[]>(() => [
  { value: '', label: t('pipelineEditor.target.selectProfile') },
  ...props.profiles.map((p) => ({ value: p.name, label: p.name })),
])

const taskProfileOptions = computed<CSelectOption[]>(() => [
  { value: '', label: t('pipelineEditor.target.taskProfileNone') },
  ...props.profiles.map((p) => ({ value: p.name, label: p.name })),
])

const taskOptions = computed<CSelectOption[]>(() => [
  { value: '', label: t('pipelineEditor.scope.selectTask') },
  ...props.tasks.map((task) => ({ value: task.task_id, label: taskDisplayName(task) })),
  { value: '__manual__', label: t('pipelineEditor.scope.manualEntry') },
])

type TargetAction = {
  key: string
  icon: 'save' | 'star' | 'trash' | 'layout' | 'play' | 'stop'
  event: 'save' | 'set-default' | 'delete-profile' | 'auto-layout' | 'preview' | 'stop'
  titleKey: string
  labelKey: string
  danger?: boolean
  disabled?: boolean
}

/**
 * Một nguồn duy nhất cho cụm action — dải icon lúc thu gọn và cụm lúc mở là
 * **cùng** các nút, chỉ khác hướng xếp; tách ra thì sửa một nơi là đủ.
 */
const actions = computed<TargetAction[]>(() => {
  const list: TargetAction[] = [
    {
      key: 'save',
      icon: 'save',
      event: 'save',
      titleKey: 'pipelineEditor.target.saveTitle',
      labelKey: 'pipelineEditor.target.save',
      disabled: props.saving || props.saveDisabled,
    },
  ]
  if (isProfileTab.value) {
    list.push(
      {
        key: 'set-default',
        icon: 'star',
        event: 'set-default',
        titleKey: 'pipelineEditor.target.setDefaultTitle',
        labelKey: 'pipelineEditor.target.setDefault',
        disabled: props.setDefaultDisabled,
      },
      {
        key: 'delete-profile',
        icon: 'trash',
        event: 'delete-profile',
        titleKey: 'pipelineEditor.target.deleteProfile',
        labelKey: 'pipelineEditor.target.deleteProfile',
        danger: true,
        disabled: !props.profileSelected,
      },
    )
  }
  list.push({
    key: 'auto-layout',
    icon: 'layout',
    event: 'auto-layout',
    titleKey: 'pipelineEditor.target.autoLayout',
    labelKey: 'pipelineEditor.target.autoLayout',
  })
  list.push(
    props.previewing
      ? {
          key: 'stop',
          icon: 'stop',
          event: 'stop',
          titleKey: 'pipelineEditor.target.stop',
          labelKey: 'pipelineEditor.target.stop',
          danger: true,
        }
      : {
          key: 'preview',
          icon: 'play',
          event: 'preview',
          titleKey: 'pipelineEditor.target.preview',
          labelKey: 'pipelineEditor.target.preview',
        },
  )
  return list
})

/** Lối vào thẳng từng section khi sub-sidebar đang thu gọn. */
const SECTION_ICONS: { key: string; icon: RailIconName; titleKey: string }[] = [
  { key: 'agents', icon: 'agent', titleKey: 'pipelineEditor.sections.agentsOpenTitle' },
  { key: 'rules', icon: 'rules', titleKey: 'pipelineEditor.sections.rulesOpenTitle' },
]
</script>

<template>
  <div class="editor-target-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- 1.1 — select đối tượng: profile ở tab Profile, task ở tab Task -->
    <template v-if="!collapsed">
      <template v-if="isProfileTab">
        <span class="target-label">{{ t('pipelineEditor.target.profileLabel') }}</span>
        <CSelect
          id="editor-target-profile"
          class="target-select"
          :model-value="profileSelected"
          :options="profileOptions"
          :aria-label="t('pipelineEditor.target.profileLabel')"
          @update:model-value="emit('update:profileSelected', $event)"
        />
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
        <span class="target-label">{{ t('pipelineEditor.target.taskLabel') }}</span>
        <CSelect
          id="editor-target-task"
          class="target-select"
          :model-value="taskSelect"
          :options="taskOptions"
          :aria-label="t('pipelineEditor.target.taskLabel')"
          @update:model-value="emit('update:taskSelect', $event)"
        />
        <input
          v-if="taskSelect === '__manual__'"
          class="target-input cfg-input"
          :value="taskManual"
          :placeholder="t('pipelineEditor.scope.taskIdPlaceholder')"
          :aria-label="t('pipelineEditor.scope.taskIdPlaceholder')"
          @input="emit('update:taskManual', ($event.target as HTMLInputElement).value)"
        />

        <!-- b.1 — đổi profile chỉ nạp bản nháp lên canvas, phải bấm Save mới ghi -->
        <span class="target-label">{{ t('pipelineEditor.target.taskProfileLabel') }}</span>
        <CSelect
          id="editor-target-task-profile"
          class="target-select"
          :model-value="taskProfile"
          :options="taskProfileOptions"
          :aria-label="t('pipelineEditor.target.taskProfileLabel')"
          @update:model-value="emit('update:taskProfile', $event)"
        />
      </template>
    </template>

    <!-- 1.2 + 1.3 — một nút Save duy nhất, cụm action nằm hẳn trong sub-sidebar.
         Lúc thu gọn vẫn đủ cả 5 nút (kể cả Stop khi đang preview). -->
    <div class="target-actions" :class="{ 'target-actions--rail': collapsed }">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        class="icon-btn"
        :class="{ danger: action.danger }"
        :title="t(action.titleKey)"
        :aria-label="t(action.labelKey)"
        :disabled="action.disabled"
        @click="emit(action.event)"
      >
        <Icon :name="action.icon" />
      </button>
    </div>

    <div v-if="collapsed" class="target-sections-rail">
      <button
        v-for="section in SECTION_ICONS"
        :key="section.key"
        type="button"
        class="rail-icon-btn target-section-icon"
        :title="t(section.titleKey)"
        :aria-label="t(section.titleKey)"
        @click="emit('open-section', section.key)"
      >
        <RailIcon :name="section.icon" />
      </button>
    </div>

    <template v-else>
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

/* Class truyền vào CSelect chỉ lo kích thước — style control là của `.c-select`. */
.target-select { width: 100%; }

.target-input { padding: 4px 7px; font-size: 12px; min-width: 0; }

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
