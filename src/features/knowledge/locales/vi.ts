// Strings for the `knowledge` feature module (knowledge base panel: list,
// filters, editor form, upload box, status messages).
export default {
  title: 'Knowledge',
  actions: {
    upload: 'Upload',
    create: '+ Tạo mới',
    save: 'Lưu',
    delete: 'Xóa',
  },
  upload: {
    scope: 'Scope',
    tags: 'Tags (phân cách bằng dấu phẩy)',
    file: 'File (.md, .txt)',
  },
  scopeTabs: {
    project: 'Project',
    system: 'System',
    global: 'Global',
  },
  filters: {
    searchPlaceholder: 'Tìm…',
    allTags: 'Tất cả tags',
  },
  collections: {
    title: 'Collection',
    empty: 'Chưa có collection.',
    scope: 'Phạm vi collection',
    clear: 'Bỏ lọc',
    create: 'Thêm',
    namePlaceholder: 'Tên collection…',
    addEntry: 'Thêm entry đang mở vào collection này',
    delete: 'Xoá collection (không xoá tài liệu)',
    confirmDelete: 'Xoá collection "{id}"? Tài liệu bên trong vẫn giữ nguyên.',
    created: 'Đã tạo collection {id}',
    deleted: 'Đã xoá collection {id}',
    entryAdded: 'Đã thêm vào {id}',
    loadFailed: 'Không đọc được collections.yaml: {error}. Sửa file trên đĩa rồi tải lại — tạm khoá thao tác nhóm để không ghi đè mất dữ liệu cũ.',
  },
  tagAdmin: {
    from: 'Đổi tên tag…',
    toPlaceholder: 'tên mới (bỏ trống = xoá tag)',
    apply: 'Đổi tên',
    done: 'Đã cập nhật {count} entry',
  },
  list: {
    loading: 'Đang tải…',
    empty: 'Chưa có entry.',
  },
  fields: {
    title: 'Title',
    slug: 'Slug',
    slugPlaceholder: 'auto từ title',
    scope: 'Scope',
    tags: 'Tags',
    addTagPlaceholder: 'Thêm tag…',
    content: 'Nội dung (Markdown)',
  },
  editor: {
    empty: 'Chọn entry hoặc tạo mới.',
  },
  messages: {
    saved: 'Đã lưu {id}',
    deleted: 'Đã xóa',
    uploaded: 'Đã upload {id}',
    confirmDelete: 'Xóa "{id}"?',
  },
}
