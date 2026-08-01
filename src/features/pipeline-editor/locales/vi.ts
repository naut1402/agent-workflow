// UI strings cho feature module `pipeline-editor` (canvas biên tập pipeline,
// panel catalog/rules/step, preview mô phỏng). vi là nguồn chân lý schema.
export default {
  toolbar: {
    fanOutWarning:
      'Orchestrator chạy tuần tự — nhánh song song sẽ được sắp xếp theo thứ tự topo khi lưu',
  },
  scope: {
    selectTask: '— Chọn task —',
    manualEntry: 'Nhập thủ công…',
    taskIdPlaceholder: 'Mã task',
  },
  leftPanel: {
    expandTitle: 'Mở catalog & rules',
    collapseTitle: 'Thu gọn catalog',
    catalogOpenTitle: 'Catalog — mở panel',
    rulesOpenTitle: 'Rules — mở panel',
  },
  preview: {
    waitingHitl: '— chờ HITL',
    status: {
      pending: '⏳ Chờ',
      active: '▶ Đang chạy',
      done: '✓ Xong',
      hitl: '⏸ HITL',
    },
  },
  rules: {
    noStepUsing: '— không dùng bởi step nào',
  },
}
