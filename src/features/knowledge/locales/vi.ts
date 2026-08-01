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
  },
  filters: {
    searchPlaceholder: 'Tìm…',
    allTags: 'Tất cả tags',
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
