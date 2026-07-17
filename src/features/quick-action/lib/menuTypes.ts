/** POC / E0003 — menu node shape (production will move to shared/schemas). */
export type ArtifactMenuNode = {
  id: string
  label: string
  action_id?: string
  children?: ArtifactMenuNode[]
}
