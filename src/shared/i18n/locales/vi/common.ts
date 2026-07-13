// Shell + shared UI strings (sidebar, status, language switcher, API error
// fallbacks). Feature-specific strings live in their own namespace file.
export const common = {
  brand: 'Dev Team',
  sidebar: {
    expand: 'Mở sidebar',
    collapse: 'Thu gọn sidebar',
    connected: 'live',
    disconnected: 'disconnected',
    settings: 'Cài đặt',
  },
  modes: {
    monitor: 'Monitor',
    pipelineEditor: 'Pipeline Editor',
    agentEditor: 'Agent Editor',
    quickAction: 'Quick Action',
    knowledge: 'Knowledge',
    runner: 'Runner',
    runnerConfig: 'Runner Config',
    logs: 'Nhật ký',
  },
  status: {
    updated: 'cập nhật {time}',
    paused: {
      editor: 'editor mode — polling paused',
      agentEditor: 'agent editor — polling paused',
      quickAction: 'quick action — polling paused',
      knowledge: 'knowledge — polling paused',
      runner: 'runner config — polling paused',
      logs: 'nhật ký — polling paused',
    },
  },
  language: {
    title: 'Ngôn ngữ',
    desc: 'Chọn ngôn ngữ hiển thị của giao diện.',
    vi: 'Tiếng Việt',
    en: 'English',
  },
  errors: {
    updateTaskStatus: 'Không thể cập nhật trạng thái task (mã lỗi {status})',
    archiveTask: 'Không thể lưu trữ task (mã lỗi {status})',
    saveCustomAgent: 'Không lưu được custom agent (server không trả về tên).',
  },
}
