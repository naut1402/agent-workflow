// Facade `api` cho quick-action — artifact-actions catalog (issue #159 Việc 2+).
import { fetchArtifactActionsCatalog, saveArtifactActionsCatalog } from '../../api/resources/artifacts'
import { fetchRunners } from '../../api/resources/runners'
import { fetchCatalog } from '../../api/resources/catalog'

export const quickActionApi = {
  fetchArtifactActionsCatalog,
  saveArtifactActionsCatalog,
  fetchRunners,
  fetchCatalog,
}
