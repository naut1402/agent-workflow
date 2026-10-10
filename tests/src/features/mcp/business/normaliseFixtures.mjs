// Bộ fixture raw dùng chung cho TC-CX-06 (#386) — **nguồn duy nhất**, để bản
// snapshot chụp trên base `4c58b44` và lượt so sau refactor chạy trên đúng cùng
// một input. Để hai nơi khai riêng là so hai thứ khác nhau mà tưởng là một.
//
// Sinh lại snapshot (chỉ làm MỘT lần, trên base):
//   git worktree add /tmp/base-4c58b44 4c58b44
//   ln -s <repo>/node_modules /tmp/base-4c58b44/node_modules
//   bun <script đọc file này> > normaliseMcpServer.base-4c58b44.json
//
// 🚫 Không sinh lại trên HEAD: snapshot sinh sau khi sửa code 🚫 chứng minh được gì
// (`test-spec.md` A-6).
export const NORMALISE_FIXTURES = [
  { name: 'stdio tối thiểu', raw: { id: 'a', transport: 'stdio', command: 'npx' } },
  {
    name: 'stdio đủ field',
    raw: {
      id: 'full',
      label: 'Đầy đủ',
      enabled: true,
      transport: 'stdio',
      command: ' npx ',
      args: ['-y', '@x/srv'],
      env: { TOKEN: 'sk-abc', REF: 'env:HOME' },
      cwd: ' /tmp/ws ',
      timeoutMs: 30000,
      lastCheck: { at: '2026-01-01T00:00:00.000Z', ok: true, toolCount: 2, toolNames: ['a', 'b'] },
    },
  },
  { name: 'stdio thiếu command', raw: { id: 'b', transport: 'stdio' } },
  { name: 'stdio command rỗng', raw: { id: 'c', transport: 'stdio', command: '' } },
  { name: 'stdio command toàn khoảng trắng', raw: { id: 'd', transport: 'stdio', command: '   ' } },
  {
    name: 'stdio args lẫn kiểu sai',
    raw: { id: 'e', transport: 'stdio', command: 'npx', args: ['ok', 5, null, { x: 1 }, 'hai'] },
  },
  {
    name: 'stdio env kiểu sai',
    raw: { id: 'f', transport: 'stdio', command: 'npx', env: { A: 1, B: 'hai', C: null } },
  },
  { name: 'stdio enabled=false', raw: { id: 'g', transport: 'stdio', command: 'npx', enabled: false } },
  { name: 'stdio enabled vắng', raw: { id: 'h', transport: 'stdio', command: 'npx' } },
  { name: 'stdio timeoutMs = 0', raw: { id: 'i', transport: 'stdio', command: 'npx', timeoutMs: 0 } },
  { name: 'stdio timeoutMs âm', raw: { id: 'j', transport: 'stdio', command: 'npx', timeoutMs: -5 } },
  {
    name: 'stdio timeoutMs không nguyên',
    raw: { id: 'k', transport: 'stdio', command: 'npx', timeoutMs: 1234.56 },
  },
  { name: 'stdio label rỗng', raw: { id: 'l', transport: 'stdio', command: 'npx', label: '' } },
  {
    name: 'stdio label quá dài',
    raw: { id: 'm', transport: 'stdio', command: 'npx', label: 'z'.repeat(200) },
  },
  { name: 'stdio field thừa', raw: { id: 'n', transport: 'stdio', command: 'npx', khongDung: 'bỏ' } },
  { name: 'http đủ field', raw: { id: 'o', transport: 'http', url: ' https://a.example/mcp ', headers: { 'X-K': 'v' } } },
  { name: 'http thiếu url', raw: { id: 'p', transport: 'http' } },
  { name: 'http url rỗng', raw: { id: 'q', transport: 'http', url: '  ' } },
  { name: 'sse đủ field', raw: { id: 'r', transport: 'sse', url: 'https://a.example/sse', credentialId: 'c1', authHeader: 'X-API-Key', authScheme: '' } },
  { name: 'sse thiếu url', raw: { id: 's', transport: 'sse' } },
  { name: 'transport lạ ws', raw: { id: 't', transport: 'ws', url: 'https://a.example' } },
  { name: 'transport rỗng', raw: { id: 'u', transport: '', command: 'npx' } },
  { name: 'transport undefined', raw: { id: 'v', command: 'npx' } },
  { name: 'transport là số', raw: { id: 'w', transport: 3, command: 'npx' } },
  { name: 'id không hợp lệ VÀ thiếu command', raw: { id: '///', transport: 'stdio' } },
  { name: 'id không hợp lệ, transport hợp lệ', raw: { id: '///', transport: 'http', url: 'https://a.example' } },
  { name: 'id vắng', raw: { transport: 'stdio', command: 'npx' } },
  { name: 'lastCheck vắng', raw: { id: 'x', transport: 'stdio', command: 'npx' } },
  { name: 'lastCheck kiểu sai', raw: { id: 'y', transport: 'stdio', command: 'npx', lastCheck: 'hỏng' } },
  { name: 'raw là null', raw: null },
  { name: 'raw là chuỗi', raw: 'khong-phai-object' },
]
