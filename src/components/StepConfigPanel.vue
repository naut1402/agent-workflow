<script setup>
import { ref, watch, onMounted } from 'vue'
import { fetchKnowledgeList } from '../api.js'

const props = defineProps({
  stepId: { type: String, default: null },
  step: { type: Object, default: null },  // current step data
  catalog: { type: Object, required: true },
  ruleCategories: { type: Array, default: () => [] },
})

const emit = defineEmits(['update', 'close'])

const knowledgeEntries = ref([])
const knowledgeInput = ref('')

onMounted(async () => {
  try {
    const data = await fetchKnowledgeList()
    knowledgeEntries.value = data.entries || []
  } catch {
    knowledgeEntries.value = []
  }
})

// Local draft — reset when step changes.
const draft = ref(null)

watch(
  () => props.step,
  (s) => {
    if (!s) { draft.value = null; return }
    draft.value = {
      name: s.label || '',
      agent: s.agent || '',
      skills: [...(s.skills || [])],
      rule_category: s.rule_category || '',
      rule_required: s.rule_required ?? true,
      produces: [...(s.produces || [])],
      hitl_mode: s.hitl?.mode || 'none',
      hitl_gate_id: s.hitl?.gate_id || '',
      hitl_optional_doc_review: s.hitl?.optional_doc_review ?? false,
      hitl_blocking: s.hitl?.blocking ?? false,
      knowledge_inputs: [...(s.knowledge_inputs || [])],
    }
  },
  { immediate: true },
)

// Tag inputs (produces, skills)
const producesInput = ref('')
const skillsInput = ref('')

function addProduces() {
  const v = producesInput.value.trim()
  if (v && draft.value && !draft.value.produces.includes(v)) {
    draft.value.produces.push(v)
  }
  producesInput.value = ''
}

function removeProduces(i) {
  draft.value.produces.splice(i, 1)
}

function addSkill() {
  const v = skillsInput.value.trim()
  if (v && draft.value && !draft.value.skills.includes(v)) {
    draft.value.skills.push(v)
  }
  skillsInput.value = ''
}

function removeSkill(i) {
  draft.value.skills.splice(i, 1)
}

function addKnowledgeInput() {
  const v = knowledgeInput.value.trim()
  if (v && draft.value && !draft.value.knowledge_inputs.includes(v)) {
    draft.value.knowledge_inputs.push(v)
  }
  knowledgeInput.value = ''
}

function removeKnowledgeInput(i) {
  draft.value.knowledge_inputs.splice(i, 1)
}

function apply() {
  if (!draft.value) return
  const hitl = draft.value.hitl_mode === 'none'
    ? { mode: 'none' }
    : {
        mode: draft.value.hitl_mode,
        gate_id: draft.value.hitl_gate_id || `hitl-${props.stepId}`,
        optional_doc_review: draft.value.hitl_optional_doc_review,
        blocking: draft.value.hitl_blocking,
      }
  emit('update', props.stepId, {
    label: draft.value.name,
    agent: draft.value.agent,
    skills: draft.value.skills,
    rule_category: draft.value.rule_category,
    rule_required: draft.value.rule_required,
    produces: draft.value.produces,
    knowledge_inputs: draft.value.knowledge_inputs,
    hitl,
  })
}
</script>

<template>
  <aside class="step-config-panel" v-if="draft">
    <div class="step-config-head">
      <span>Configure step</span>
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>

    <div class="step-config-body">
      <!-- Name -->
      <label class="cfg-label">
        Name
        <input v-model="draft.name" class="cfg-input" placeholder="Step name" />
      </label>

      <!-- Agent -->
      <label class="cfg-label">
        Agent
        <input
          v-model="draft.agent"
          class="cfg-input"
          list="catalog-agents-list"
          placeholder="plugin:agent-name"
        />
        <datalist id="catalog-agents-list">
          <option v-for="a in (catalog.agents || [])" :key="a.id" :value="a.id">{{ a.name }}</option>
        </datalist>
      </label>

      <!-- Skills -->
      <label class="cfg-label">
        Skills
        <div class="tag-row">
          <span v-for="(sk, i) in draft.skills" :key="sk" class="chip chip-skill chip-rm" @click="removeSkill(i)">
            {{ sk }} ✕
          </span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="skillsInput"
            class="cfg-input cfg-input-sm"
            list="catalog-skills-list"
            placeholder="Add skill…"
            @keydown.enter.prevent="addSkill"
          />
          <datalist id="catalog-skills-list">
            <option v-for="s in (catalog.skills || [])" :key="s.id" :value="s.name">{{ s.name }}</option>
          </datalist>
          <button class="btn-ghost btn-sm" @click="addSkill">+</button>
        </div>
      </label>

      <!-- Rule category -->
      <label class="cfg-label">
        Rule category
        <select v-model="draft.rule_category" class="cfg-input">
          <option value="">— none —</option>
          <option v-for="cat in ruleCategories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
        <input
          v-if="!ruleCategories.length"
          v-model="draft.rule_category"
          class="cfg-input cfg-input-mt"
          placeholder="e.g. doc-writing"
        />
      </label>

      <!-- Rule required -->
      <label class="cfg-label cfg-label-row">
        <input type="checkbox" v-model="draft.rule_required" />
        Rule required (block pipeline if missing)
      </label>

      <!-- Produces -->
      <label class="cfg-label">
        Produces (artifacts)
        <div class="tag-row">
          <span v-for="(f, i) in draft.produces" :key="f" class="chip chip-rm" @click="removeProduces(i)">
            {{ f }} ✕
          </span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="producesInput"
            class="cfg-input cfg-input-sm"
            placeholder="e.g. investigate.md"
            @keydown.enter.prevent="addProduces"
          />
          <button class="btn-ghost btn-sm" @click="addProduces">+</button>
        </div>
      </label>

      <!-- Knowledge inputs -->
      <label class="cfg-label">
        Knowledge inputs
        <div class="tag-row">
          <span
            v-for="(kid, i) in draft.knowledge_inputs"
            :key="kid"
            class="chip chip-rm"
            @click="removeKnowledgeInput(i)"
          >{{ kid }} ✕</span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="knowledgeInput"
            class="cfg-input cfg-input-sm"
            list="knowledge-entries-list"
            placeholder="project/slug…"
            @keydown.enter.prevent="addKnowledgeInput"
          />
          <datalist id="knowledge-entries-list">
            <option v-for="e in knowledgeEntries" :key="e.id" :value="e.id">{{ e.title }}</option>
          </datalist>
          <button class="btn-ghost btn-sm" type="button" @click="addKnowledgeInput">+</button>
        </div>
      </label>

      <!-- HITL mode -->
      <label class="cfg-label">
        HITL gate
        <select v-model="draft.hitl_mode" class="cfg-input">
          <option value="none">None</option>
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      <template v-if="draft.hitl_mode !== 'none'">
        <label class="cfg-label">
          Gate ID
          <input v-model="draft.hitl_gate_id" class="cfg-input" placeholder="hitl-1" />
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_optional_doc_review" />
          Optional doc review at this gate
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_blocking" />
          Blocking (requires human even with --auto-review)
        </label>
      </template>
    </div>

    <div class="step-config-footer">
      <button class="btn-ghost" @click="emit('close')">Cancel</button>
      <button class="btn-primary" @click="apply">Apply</button>
    </div>
  </aside>
</template>
