// QuickAction module — CRUD panel for the artifact-actions catalog (F0005).
// vi is the source of truth for the message schema (see en/quickAction.ts).
// `{param}` = named interpolation; `{'{'}` = a literal brace (the prompt help
// tokens are shown verbatim, so their braces are escaped).
export const quickAction = {
  title: 'Quick Action',
  subtitle: 'CRUD các quick action gắn vào artifact viewer (title toolbar / selection toolbar).',
  empty: 'Chưa có quick action nào.',
  newAction: '+ Mới',
  directPrompt: '(prompt trực tiếp)',
  approvalBadge: '✓ phê duyệt',
  approvalBadgeTitle: 'Yêu cầu phê duyệt trước khi ghi',
  runnerDefault: '(default)',
  attachPoints: 'Attach points',
  actions: {
    edit: 'Sửa',
    delete: 'Xóa',
    copy: 'Sao chép',
  },
  menu: {
    manage: 'Quản lý menu',
    dialogTitle: 'Quản lý menu Quick Action',
    dialogHint:
      'Đổi tên / sắp xếp / xóa nhóm menu. Gắn action vào menu ngay trên form tạo/sửa quick action.',
    addGroup: 'Thêm nhóm',
    moveUp: 'Lên',
    moveDown: 'Xuống',
    deleteNode: 'Xóa node',
    renameLabel: 'Tên hiển thị',
    save: 'Lưu menu',
    newGroup: 'Nhóm mới',
    createTitle: 'Thêm menu',
    createNameLabel: 'Tên menu',
    createNamePlaceholder: 'Tài liệu',
    createNameRequired: 'Tên menu không được để trống',
    createParentLabel: 'Menu cha (tuỳ chọn)',
    createParentNone: '(không — menu gốc)',
    createSave: 'Tạo menu',
  },
  form: {
    newTitle: 'Quick action mới',
    editTitle: 'Sửa "{name}"',
    copyTitle: 'Sao chép "{name}"',
    close: 'Đóng',
    labelPlaceholder: '✨ Cải thiện tài liệu',
    patternsLabel: 'artifact_patterns (phân tách bằng dấu phẩy)',
    agentLabel: 'agent (tuỳ chọn — để "prompt trực tiếp" thì chạy thẳng prompt_template, không gắn agent)',
    agentNone: '(prompt trực tiếp — không gắn agent)',
    agentCurrent: '{ref} (hiện tại)',
    menuLabel: 'Menu (tuỳ chọn)',
    menuNone: '(không — nút độc lập trên toolbar)',
    menuHint: 'Chọn menu để hiện trong dropdown; để trống thì nút flat trên Monitor.',
    addMenu: 'Thêm menu',
    promptHelpTitleAttr: 'Xem danh sách placeholder hỗ trợ',
    promptHelpAria: 'Xem danh sách placeholder hỗ trợ trong prompt_template',
    promptPlaceholder:
      "Đọc {'{'}{'{'}artifact_name{'}'}{'}'} / {'{'}{'{'}artifact_base{'}'}{'}'} / {'{'}{'{'}selection{'}'}{'}'}…",
    runnerLabel: 'runner (optional — mặc định dùng runner mặc định của hệ thống)',
    confirmOption: 'Yêu cầu xác nhận trước khi chạy',
    approvalOption: 'Yêu cầu phê duyệt trước khi ghi (xem diff)',
    saving: 'Đang lưu…',
    save: 'Lưu',
    cancel: 'Hủy',
  },
  promptHelp: {
    heading: 'Placeholder hỗ trợ trong prompt_template:',
    selectionNote:
      '(chỉ có giá trị khi action gắn attach point "Text selection" và được chạy từ vùng đã chọn — trống nếu chạy từ title toolbar)',
    writeNote:
      'Lưu ý: để action thực sự thay đổi file, prompt phải yêu cầu agent GHI ĐÈ file (dùng công cụ Write) — stdout của runner KHÔNG được ghi lại vào file.',
    placeholders: {
      artifactName: 'Tên file artifact đầy đủ, ví dụ "design.md".',
      artifactBase: 'Tên file artifact không có phần mở rộng, ví dụ "design".',
      selection: 'Đoạn văn bản người dùng đã bôi đen trong artifact viewer.',
      selectionLines: 'Dòng (trong file gốc) tương ứng vùng đã chọn, dạng "12" hoặc "12-15".',
    },
  },
  confirm: {
    remove: 'Xóa quick action "{label}"?',
  },
  messages: {
    saved: 'Đã lưu "{label}"',
    removed: 'Đã xóa "{label}"',
  },
  errors: {
    idRequired: 'id không được để trống',
    patternRequired: 'cần ít nhất 1 artifact pattern',
    labelRequired: 'label không được để trống',
    promptRequired: 'prompt_template không được để trống',
    idExists: 'id "{id}" đã tồn tại',
    saveFailed: 'Lưu thất bại',
  },
}
