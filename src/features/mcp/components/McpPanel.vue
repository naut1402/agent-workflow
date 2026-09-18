<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, onMounted } from 'vue'
import { deleteMcpServer, fetchMcpServers, saveMcpServer } from '../scripts/mcpApi'
import type { McpServerConfig } from '../business/types'
import Icon from '../../../frontend/ui/Icon.vue'
import McpServerDialog from './McpServerDialog.vue'

const { t } = useI18nHelpers()

const servers = ref<McpServerConfig[]>([])
const message = ref('')
const error = ref('')
const showDialog = ref(false)
const editing = ref<McpServerConfig | null>(null)

async function load() {
  error.value = ''
  try {
    const data = await fetchMcpServers()
    servers.value = data.servers || []
  } catch (e: any) {
    error.value = String(e.message || e) || t('mcp.errors.loadFailed')
  }
}

onMounted(load)

function openNew() {
  editing.value = null
  showDialog.value = true
  message.value = ''
}

function openEdit(s: McpServerConfig) {
  editing.value = JSON.parse(JSON.stringify(s))
  showDialog.value = true
  message.value = ''
}

function openCopy(s: McpServerConfig, e: Event) {
  e.stopPropagation()
  editing.value = { ...JSON.parse(JSON.stringify(s)), id: `${s.id}-copy`, enabled: false, lastCheck: null }
  showDialog.value = true
  message.value = ''
}

function closeDialog() {
  showDialog.value = false
  editing.value = null
}

async function onSaved(id: string) {
  message.value = t('mcp.panel.saved', { id })
  await load()
}

async function toggleEnabled(s: McpServerConfig, e: Event) {
  e.stopPropagation()
  try {
    await saveMcpServer({ ...s, enabled: !s.enabled })
    await load()
  } catch (err: any) {
    error.value = String(err.message || err) || t('mcp.errors.saveFailed')
  }
}

async function remove(s: McpServerConfig, e: Event) {
  e.stopPropagation()
  if (!confirm(t('mcp.panel.confirmDelete', { id: s.id }))) return
  try {
    await deleteMcpServer(s.id)
    message.value = t('mcp.panel.deleted')
    if (editing.value?.id === s.id) closeDialog()
    await load()
  } catch (err: any) {
    error.value = String(err.message || err) || t('mcp.errors.deleteFailed')
  }
}

function checkLabel(s: McpServerConfig): string {
  if (!s.lastCheck) return t('mcp.panel.never')
  if (!s.lastCheck.ok) return t('mcp.panel.checkFailed')
  return t('mcp.panel.checkOk', { count: s.lastCheck.toolCount })
}
</script>

<template>
  <div class="mcp-panel">
    <header class="mcp-head">
      <h2>{{ t('mcp.panel.title') }}</h2>
      <p class="muted">{{ t('mcp.panel.subtitle') }}</p>
    </header>

    <div v-if="error" class="err-banner">{{ error }}</div>
    <div v-if="message" class="ok-banner">{{ message }}</div>

    <div class="mcp-toolbar">
      <button type="button" class="btn-primary btn-sm" @click="openNew">{{ t('mcp.panel.add') }}</button>
    </div>

    <ul class="mcp-list">
      <li v-if="!servers.length" class="empty muted">{{ t('mcp.panel.empty') }}</li>
      <li
        v-for="s in servers"
        :key="s.id"
        :class="{ disabled: !s.enabled }"
        @click="openEdit(s)"
      >
        <div class="mcp-item-main">
          <strong>{{ s.label || s.id }}</strong>
          <span class="mcp-chips">
            <span class="chip">{{ t(`mcp.transport.${s.transport}`) }}</span>
            <span class="chip" :class="{ ok: s.lastCheck?.ok, bad: s.lastCheck && !s.lastCheck.ok }">
              {{ checkLabel(s) }}
            </span>
          </span>
        </div>
        <div class="mcp-item-actions" @click.stop>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: s.enabled }"
            :title="s.enabled ? t('mcp.panel.toggleOff') : t('mcp.panel.toggleOn')"
            :aria-label="s.enabled ? t('mcp.panel.toggleOff') : t('mcp.panel.toggleOn')"
            @click="toggleEnabled(s, $event)"
          >
            <Icon name="play" />
          </button>
          <button
            type="button"
            class="icon-btn"
            :title="t('mcp.panel.copy')"
            :aria-label="t('mcp.panel.copy')"
            @click="openCopy(s, $event)"
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            class="icon-btn danger"
            :title="t('mcp.panel.delete')"
            :aria-label="t('mcp.panel.delete')"
            @click="remove(s, $event)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </li>
    </ul>

    <McpServerDialog
      v-if="showDialog"
      :server="editing"
      @close="closeDialog"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped lang="scss">
.mcp-panel { padding: 1rem 1.25rem; max-width: 960px; }
.mcp-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--muted); font-size: 0.85rem; }
.mcp-toolbar { margin: 1rem 0 0.75rem; }
.mcp-list { list-style: none; padding: 0; margin: 0; max-width: 640px; }
.mcp-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
  cursor: pointer;
}
.mcp-list li:hover { border-color: var(--accent); background: var(--panel-2); }
.mcp-list li.disabled { opacity: 0.45; }
.mcp-list li.empty { cursor: default; border-style: dashed; opacity: 1; }
.mcp-list li.empty:hover { border-color: var(--border); background: transparent; }
.mcp-item-main { min-width: 0; flex: 1; }
.mcp-item-main strong { display: block; font-size: 0.95rem; }
.mcp-chips { display: inline-flex; gap: 0.35rem; margin-top: 0.2rem; }
.chip {
  font-size: 0.72rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.chip.ok { border-color: var(--done); color: var(--done); }
.chip.bad { border-color: var(--danger); color: var(--danger); }
.mcp-item-actions { display: flex; align-items: center; gap: 0.15rem; flex-shrink: 0; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
.ok-banner {
  background: rgba(63, 185, 80, 0.12);
  border: 1px solid var(--done);
  color: var(--done);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
</style>
