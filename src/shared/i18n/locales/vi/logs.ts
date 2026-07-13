// Strings for the `logs` feature module (LogsPanel + TaskTimeline). Filled by
// the logs i18n slice (issue #99, epic #94). vi is the source of truth; keep
// keys in sync with en/logs.ts.
export const logs = {
  title: 'Nhật ký',
  subtitle: 'Log tập trung (global ~/.dev-team-dashboard/logs/)',
  tabs: {
    audit: 'Kiểm toán',
    request: 'Yêu cầu',
    jobs: 'Jobs',
  },
  columns: {
    time: 'Thời gian',
    op: 'Thao tác',
    entity: 'Đối tượng',
    identifier: 'Định danh',
    project: 'Project',
    method: 'Method',
    path: 'Path',
    status: 'Status',
    ms: 'ms',
  },
  empty: {
    log: 'Chưa có log.',
    job: 'Chưa có job.',
  },
  jobs: {
    tailStart: '▶ Tail',
    tailStop: '⏹ Dừng tail',
    truncated: '(đã cắt phần đầu)',
    logEmpty: '(log trống)',
    selectPrompt: 'Chọn một job để xem log.',
  },
  timeline: {
    heading: 'Dòng thời gian hoạt động',
    empty: 'Chưa có hoạt động nào.',
    now: 'hiện tại',
    artifactDetail: 'tạo artifact',
    phaseDetail: 'đang chạy',
    hitlDetail: 'chờ duyệt',
  },
}
