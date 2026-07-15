// Strings for the settings module (SettingsDialog). The language section
// reuses common.language.* — those keys are NOT duplicated here.
export const settings = {
  title: 'Cài đặt',
  close: 'Đóng',
  theme: {
    title: 'Giao diện',
    desc: 'Chọn giao diện sáng, tối, hoặc theo hệ thống.',
    system: 'Hệ thống',
    light: 'Sáng',
    dark: 'Tối',
  },
  artifact: {
    title: 'Artifact',
    desc: 'Chế độ xem mặc định khi mở tài liệu mới.',
    groupLabel: 'Chế độ xem artifact mặc định',
    block: 'Block theo H2',
    full: 'Full',
  },
  taskList: {
    title: 'Danh sách task',
    desc: 'Tuỳ chọn hành vi danh sách task ở Monitor mode.',
    collapseOnOutsideClick: 'Tự thu gọn file-list khi click ra ngoài',
  },
  sidebar: {
    title: 'Sidebar',
    desc: 'Tự động thu gọn thanh bên khi click ra ngoài vùng sidebar.',
    collapseAppOnOutsideClick: 'Tự thu gọn sidebar chính khi click ra ngoài',
    collapseMonitorSubOnOutsideClick: 'Tự thu gọn sub-sidebar Monitor khi click ra ngoài',
  },
}
