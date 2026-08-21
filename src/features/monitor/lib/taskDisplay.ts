/** Label hiển thị cho task — luôn fallback về task_id khi không có name. */
export function taskDisplayName(task: Record<string, any>): string {
  const n = typeof task?.name === 'string' ? task.name.trim() : ''
  return n ? n : task?.task_id
}
