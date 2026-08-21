/** Label hiển thị cho task — luôn fallback về task_id khi không có name. */
export function taskDisplayName(task: { name?: string | null; task_id: string }): string {
  const n = task.name?.trim()
  return n ? n : task.task_id
}
