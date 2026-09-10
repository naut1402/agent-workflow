// English translations for the `knowledge` namespace — keys mirror vi/knowledge.ts.
export default {
  title: 'Knowledge',
  actions: {
    upload: 'Upload',
    create: '+ New',
    save: 'Save',
    delete: 'Delete',
  },
  upload: {
    scope: 'Scope',
    tags: 'Tags (comma-separated)',
    file: 'File (.md, .txt)',
  },
  scopeTabs: {
    project: 'Project',
    system: 'System',
    global: 'Global',
  },
  filters: {
    searchPlaceholder: 'Search…',
    allTags: 'All tags',
  },
  collections: {
    title: 'Collections',
    empty: 'No collection yet.',
    clear: 'Clear',
    create: 'Add',
    namePlaceholder: 'Collection name…',
    addEntry: 'Add the open entry to this collection',
    delete: 'Delete the collection (keeps the documents)',
    confirmDelete: 'Delete collection "{id}"? The documents stay.',
    created: 'Created collection {id}',
    deleted: 'Deleted collection {id}',
    entryAdded: 'Added to {id}',
    loadFailed: 'Cannot read collections.yaml: {error}. Fix the file on disk and reload — collection actions are disabled so nothing overwrites it.',
  },
  tagAdmin: {
    from: 'Rename tag…',
    toPlaceholder: 'new name (empty = remove)',
    apply: 'Rename',
    done: 'Updated {count} entries',
  },
  list: {
    loading: 'Loading…',
    empty: 'No entries yet.',
  },
  fields: {
    title: 'Title',
    slug: 'Slug',
    slugPlaceholder: 'auto from title',
    scope: 'Scope',
    tags: 'Tags',
    addTagPlaceholder: 'Add tag…',
    content: 'Content (Markdown)',
  },
  editor: {
    empty: 'Select an entry or create a new one.',
  },
  messages: {
    saved: 'Saved {id}',
    deleted: 'Deleted',
    uploaded: 'Uploaded {id}',
    confirmDelete: 'Delete "{id}"?',
  },
}
