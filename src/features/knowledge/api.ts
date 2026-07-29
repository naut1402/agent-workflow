// Facade `api` cho knowledge — knowledge CRUD (issue #159 Việc 2+).
import {
  fetchKnowledgeList,
  fetchKnowledgeEntry,
  createKnowledgeEntry,
  saveKnowledgeEntry,
  deleteKnowledgeEntry,
  fetchKnowledgeTags,
  uploadKnowledgeFile,
} from '../../api/resources/knowledge'

export const knowledgeApi = {
  fetchKnowledgeList,
  fetchKnowledgeEntry,
  createKnowledgeEntry,
  saveKnowledgeEntry,
  deleteKnowledgeEntry,
  fetchKnowledgeTags,
  uploadKnowledgeFile,
}
