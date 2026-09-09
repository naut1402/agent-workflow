// Running jobs — floating icon + hover list (global running jobs).
// vi is the source of truth for the message schema. `{param}` = named interpolation.
export default {
  icon: {
    title: 'Job đang chạy',
  },
  list: {
    title: 'Job đang chạy',
    empty: 'Không có job nào đang chạy.',
    unknownTask: 'Chưa gán task',
    unknownStep: 'Step không xác định',
    jobCount: '{n} đang chạy',
    truncated: 'Và {n} task nữa…',
  },
}
