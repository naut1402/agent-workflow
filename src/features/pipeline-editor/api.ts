// Facade `api` cho pipeline-editor — pipeline CRUD (issue #159 Việc 2+).
import {
  fetchPipelineConfig,
  writePipelineConfig,
  fetchFlowProfile,
  saveFlowProfile,
  fetchPipelineProfiles,
  fetchPipelineProfile,
  savePipelineProfile,
  deletePipelineProfile,
} from '../../api/resources/pipeline'
import { fetchCatalog, fetchRules } from '../../api/resources/catalog'
import { fetchKnowledgeList } from '../../api/resources/knowledge'

export const pipelineEditorApi = {
  fetchPipelineConfig,
  writePipelineConfig,
  fetchFlowProfile,
  saveFlowProfile,
  fetchPipelineProfiles,
  fetchPipelineProfile,
  savePipelineProfile,
  deletePipelineProfile,
  fetchCatalog,
  fetchRules,
  fetchKnowledgeList,
}
