// Strings for the settings module (SettingsDialog). The language section
// reuses common.language.* — those keys are NOT duplicated here.
export const settings = {
  title: 'Cài đặt',
  close: 'Đóng',
  groups: {
    general: 'Chung',
    projects: 'Projects',
    notifications: 'Thông báo',
  },
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
  autoscan: {
    title: 'Autoscan project',
    desc: 'Tự động quét thư mục trong whitelist và thêm project có `.dev-team-agent`.',
    enabled: 'Bật autoscan',
    enabledInfo:
      'Khi bật, dashboard tự quét whitelist mỗi 60 giây trong lúc ứng dụng đang mở. Chưa hỗ trợ đổi khoảng thời gian trên UI.',
    enabledInfoAria: 'Thông tin về khoảng thời gian autoscan',
    whitelistTitle: 'Whitelist thư mục',
    whitelistDesc: 'Mỗi mục là thư mục cha — quét chính nó và một cấp thư mục con.',
    pathPlaceholder: 'Đường dẫn tuyệt đối',
    addPath: 'Thêm',
    browse: 'Chọn thư mục',
    removePath: 'Xoá khỏi whitelist',
    scanNow: 'Quét ngay',
    scanning: 'Đang quét…',
    save: 'Lưu',
    saving: 'Đang lưu…',
    saved: 'Đã lưu.',
    resultAdded: 'Đã thêm {count} project.',
    resultExisting: '{count} đã có sẵn.',
    resultNone: 'Không tìm thấy project mới.',
    pathRequired: 'Nhập đường dẫn tuyệt đối.',
    loadError: 'Không tải được cấu hình autoscan.',
  },
  notifications: {
    title: 'Thông báo',
    desc: 'Bật/tắt thông báo và chọn loại sự kiện muốn nhận.',
    enabled: 'Bật thông báo',
    events: {
      title: 'Loại sự kiện',
      hitlPending: 'HITL đang chờ duyệt',
      qaReady: 'QA đã sẵn sàng',
    },
    browser: {
      title: 'Thông báo trình duyệt',
      enabled: 'Bật thông báo native của trình duyệt',
      permissionDenied: 'Trình duyệt từ chối quyền thông báo — vào cài đặt trình duyệt để cấp quyền.',
    },
    sound: {
      title: 'Âm thanh',
      enabled: 'Phát âm thanh khi có thông báo mới',
    },
  },
}
