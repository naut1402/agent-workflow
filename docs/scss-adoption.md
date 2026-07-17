# Khảo sát & kế hoạch áp dụng SCSS

Tài liệu này mô tả **hiện trạng styling** frontend Vue và **kế hoạch đối ứng** nếu/ khi áp dụng SCSS. Quy ước phát triển chung: [`AGENTS.md`](../AGENTS.md). Kiến trúc tổng thể: [`architecture.md`](architecture.md).

---

## 1. Mục tiêu khảo sát

Trả lời: có nên đưa SCSS vào stack không; nếu có thì migrate thế nào để khớp feature-module, giữ theme runtime (CSS variables), và không gây visual regression.

---

## 2. Hiện trạng

### 2.1 Nguồn style

| Nguồn | Vị trí | Quy mô |
|-------|--------|--------|
| Global CSS | `src/style.css` (import từ `src/main.ts`) | ~1667 dòng, ~275 class |
| Scoped CSS | 11 / 32 SFC có `<style scoped>` (plain CSS, không `lang`) | ~550 LOC cộng dồn |
| Vendor CSS | `@vue-flow/core`, `@toast-ui/editor` | Import trong component; không đụng |

`vite.config.js` không cấu hình `css` preprocessor. `package.json` không có `sass` / `sass-embedded`.

### 2.2 Cấu trúc `style.css` (theo comment section)

| Khối | Ước lượng LOC | Nội dung |
|------|---------------|----------|
| Tokens + reset + `.layout` | ~40 | `:root` / `[data-theme]`, box model |
| Shell (sidebar, settings, mode, modal/btn dùng chung) | ~270 | Brand, footer, radios, `.btn-*` |
| Monitor | ~520 | Task list, pipeline node, artifact, markdown, mermaid, monitor-layout |
| Pipeline editor | ~560 | Catalog, rules, step config, preview, profile |
| Agent editor | ~165 | `.agent-*`, workflow builder |
| Knowledge | ~100 | `.knowledge-*` |

**Runner / Logs / Quick Action** gần như không có block global riêng — style nằm trong `<style scoped>` của feature.

### 2.3 Theme

- Token màu / surface là **CSS custom properties** trên `:root` và `[data-theme="light"|"dark"]`.
- JS: `src/shared/lib/theme.ts` + `useAppSettings` + FOUC guard trong `index.html`.
- Preference: `system` | `light` | `dark` (schema `shared/schemas/appSettings.ts`).

→ Màu theme **phải tiếp tục là CSS variables** (đổi lúc runtime). SCSS variables chỉ phù hợp cho giá trị compile-time (spacing scale, radius cố định, breakpoint nếu sau này có).

### 2.4 Tooling & kiểm chứng visual

- Prettier format `.css` / `.vue`; không Stylelint.
- ESLint `vue/block-lang` chỉ bắt `script` = `ts`, không ràng buộc `style`.
- E2E Playwright chụp screenshot evidence (`testInfo.attach`), **không** pixel-diff baseline (`toHaveScreenshot`).

### 2.5 Pain point cụ thể

1. **Monolith lệch feature-module**: monitor + pipeline-editor chiếm phần lớn `style.css`; tìm style theo mode khó.
2. **Hai “ngôn ngữ” styling**: feature cũ → global; runner/logs/quick-action/project-bar → scoped — khó thống nhất khi sửa UI.
3. **Trùng tên class** giữa global và scoped (vd `.muted`, `.qa-toolbar`, `.nl-actions`, `.cfg-input`) — scoped thắng trong SFC nhưng dễ nhầm khi đọc/copy.
4. **Token thiếu / lệch**: một số chỗ dùng `var(--accent-dim)`, `var(--ok)`, `var(--err)`, `var(--text-muted)` không khai báo đủ ở khối token; Logs hardcode hex (lệch dark theme).
5. **Không nesting / không responsive**: zero `@media`; selector phẳng dài dòng.
6. **Không gate visual tự động**: regression phụ thuộc review ảnh e2e thủ công.

---

## 3. Phương án so sánh

### A — Giữ CSS thuần (status quo)

- **Ưu**: zero dependency, zero migrate.
- **Nhược**: monolith và dual-style (global vs scoped) tiếp tục phình.
- **Khi chọn**: chỉ khi ưu tiên đóng băng UI và không đầu tư styling trong vài chu kỳ tới.

### B — CSS thuần + tách file + (tuỳ chọn) native CSS nesting

- Tách `style.css` thành nhiều file `.css` theo shell / feature, `import` từ `main.ts` hoặc một `index.css`.
- Dùng native nesting nếu cần (browser hiện đại đủ hỗ trợ; Vite forward-compatible).
- **Ưu**: không thêm Sass; vẫn align feature-module.
- **Nhược**: thiếu mixin/`@use` module system của Sass; SFC scoped vẫn plain trừ khi dùng nesting thuần.
- **Khi chọn**: muốn tổ chức lại file mà tránh dependency compile.

### C — SCSS có kiểm soát (khuyến nghị)

- Thêm `sass-embedded` (Vite 5 hỗ trợ sẵn khi có package).
- Global: `style.css` → entry `.scss` + partials `@use` theo shell/feature.
- SFC: `<style scoped lang="scss">` cho style co-located; dần migrate 11 block scoped hiện có.
- **Giữ nguyên CSS variables** cho mọi màu/surface theme; SCSS không thay thế runtime token.
- Vendor CSS giữ `.css` import như hiện tại.
- **Ưu**: nesting, partials, mixin cho pattern lặp (panel, btn row); khớp Vue SFC; align folder feature.
- **Nhược**: thêm dependency + thời gian migrate; cần quy ước rõ để tránh SCSS variables chồng CSS variables.
- **Khi chọn**: chấp nhận chi phí tooling nhỏ để trả nợ cấu trúc styling theo kiến trúc frontend hiện có.

### D — Chỉ SCSS cho component mới / scoped

- Global vẫn CSS; component mới dùng `lang="scss"`.
- **Không khuyến nghị** như chiến lược cuối: làm nặng thêm dual-language và trì hoãn tách monolith.

### Ngoài scope so sánh sâu

Tailwind / UnoCSS / CSS Modules toàn cục — chỉ ghi nhận là hướng khác; không mở epic styling-system mới trừ khi C bị bác và B cũng không đủ.

---

## 4. Khuyến nghị

**Go với phương án C — SCSS có kiểm soát**, theo lộ trình zero-behavior-change trước, tidy token song song, không redesign UI.

Lý do ngắn:

1. Frontend đã theo **feature-module**; SCSS partials/`@use` là cách tách monolith `style.css` khớp cấu trúc đó.
2. Vue SFC + Vite đã có đường `lang="scss"` ổn định; `sass-embedded` là dependency dev rõ ràng.
3. Theme runtime đã đúng hướng (CSS variables) — SCSS bổ sung cấu trúc/nesting, không thay token.
4. Phương án B giải quyết được một phần (tách file) nhưng kém hơn khi viết scoped + mixin dùng lại; chi phí thêm Sass nhỏ so với lợi ích dài hạn trên codebase UI này.

**No-go / trì hoãn nếu:** không sẵn sàng chạy lại e2e capture các mode sau mỗi slice migrate, hoặc có epic UI redesign lớn sắp đè lên cùng file style (tránh conflict). Khi đó giữ A hoặc chỉ làm B (tách file CSS) như bước trung gian.

---

## 5. Quy ước bắt buộc khi áp dụng SCSS

1. **Theme = CSS custom properties** (`var(--bg)`, …). Không đưa palette light/dark vào SCSS `$variable` trừ giá trị compile-time không đổi theo theme.
2. **Không SCSS-hóa vendor CSS** (vue-flow, toast-ui).
3. **Partials theo trách nhiệm**, không theo “một file một component” ngay từ đầu:
   - `_tokens.scss`, `_shell.scss` — phần **chung** (PR chung).
   - `_<module>.scss` — một file / module (`monitor`, `pipeline-editor`, `agent-editor`, `knowledge`, …) — **một PR / module**.
   - `_legacy-rest.scss` — tạm chứa CSS chưa tách; xoá khi hết module PR.
   - Entry `src/styles/main.scss` `@use` các partial; `main.ts` import entry.
4. **Style co-located**: UI chỉ dùng trong một SFC → `<style scoped lang="scss">` trong feature đó; pattern dùng ≥2 mode → partial shared/shell.
5. **Không đổi tên class hàng loạt** trong slice tooling/split — tránh đụng template + e2e selector cùng lúc.
6. **Mixin** chỉ cho pattern lặp thật (vd hàng nút, panel border dùng token). Cấm mixin “theme color” thay `var(--*)`.

---

## 6. Chiến lược PR & git

### 6.1 Nguyên tắc

1. **Một PR phần chung** + **một PR cho mỗi module** (không gộp nhiều module trong cùng PR migrate).
2. Mọi feature branch **checkout từ `dev/1.0.0/main`** (sau khi fetch mới nhất).
3. PR target **`dev/1.0.0/main`**; body dùng `Part of #<issue-tracking>` (không `Closes`/`Fixes`).
4. **Thứ tự merge:** PR chung merge trước → các PR module mở/rebase trên `dev/1.0.0/main` đã có phần chung. Module PR **không phụ thuộc lẫn nhau** (song song được sau khi chung đã vào).
5. Mỗi PR: zero behavior change đối với CSS đã chuyển (chỉ rearrange / `lang="scss"`); e2e capture đúng mode liên quan.

### 6.2 Đặt tên branch (gợi ý)

| PR | Branch (ví dụ) |
|----|----------------|
| Chung | `feat/scss/common` |
| Module | `feat/scss/<module>` — `<module>` ∈ `monitor` · `pipeline-editor` · `agent-editor` · `knowledge` · `runner` · `logs` · `quick-action` · `shared-ui` |

```bash
git fetch origin
git checkout -b feat/scss/<name> origin/dev/1.0.0/main
```

---

## 7. Plan đối ứng (breakdown theo PR)

### PR 0 — Khảo sát & chốt hướng (artifact này)

- [x] Mô tả hiện trạng + trade-off + khuyến nghị.
- [ ] Review/approve hướng C (hoặc chọn B) trước khi code migrate.

### PR chung — tooling + tokens + shell

**Base:** `dev/1.0.0/main`

**IN:**

- Thêm `sass-embedded` (devDependency).
- Entry: `src/style.css` → `src/styles/main.scss`; cập nhật `src/main.ts`.
- Partials dùng chung: `_tokens.scss`, `_shell.scss` (sidebar, mode, settings, modal/btn dùng chung).
- Phần CSS feature chưa migrate: giữ trong `_legacy-rest.scss` (tạm), `@use` từ entry — **xoá dần** khi từng PR module land.
- Chuẩn hoá token thiếu dùng chung (`--accent-dim`, `--ok`, …) trên light/dark trong `_tokens.scss`.
- Quy ước §5 đã đủ trong docs; không đụng style scoped từng feature.

**OUT:** tách/migrate CSS riêng monitor, pipeline-editor, agent-editor, knowledge; không đổi `lang` scoped module; không responsive/Stylelint.

**AC:**

- [ ] Build / `test:fe` xanh; preprocessor chạy được.
- [ ] Zero visual change có chủ đích (e2e: app-shell + settings theme).
- [ ] Entry chỉ `@use` tokens + shell + `_legacy-rest` (hoặc tương đương rõ ràng).

### PR theo module — mỗi module một PR

Mỗi PR dưới đây: **checkout từ `origin/dev/1.0.0/main`** (đã chứa PR chung), chỉ đụng partial + SFC của module đó.

| PR module | Lấy từ global (`_legacy-rest` / section cũ) | Scoped SFC cùng PR (thêm `lang="scss"`, nesting nhẹ) | E2E capture |
|-----------|-----------------------------------------------|------------------------------------------------------|-------------|
| **monitor** | Task list, pipeline node, artifact, md, mermaid, monitor-layout, QA banner… → `_monitor.scss` | `ProjectBar`, `PipelineNode`, `ArtifactProposalReview` | `monitor` (+ theme nếu đụng token UI) |
| **pipeline-editor** | Catalog, rules, step config, preview, profile, editor layout… → `_pipeline-editor.scss` | (thường không có scoped riêng) | `pipeline-editor` |
| **agent-editor** | `.agent-*`, workflow builder… → `_agent-editor.scss` | `AgentNlWizard` | `agent-editor` / wizard |
| **knowledge** | `.knowledge-*` → `_knowledge.scss` | — | `knowledge` |
| **runner** | (không có block global đáng kể) | `RunnerConfigPanel`, `RunnerDialog`, `ConnectionDialog` | `runner` |
| **logs** | — | `LogsPanel`, `TaskTimeline` (+ thay hardcode màu → `var(--*)` nếu an toàn) | `logs` |
| **quick-action** | — | `QuickActionPanel` | `quick-action` |
| **shared-ui** | btn/md helper còn sót thuộc shared (nếu còn trong legacy) | `MarkdownTextEditor` (`:deep` giữ nguyên ý) | smoke shell / editor dùng markdown |

**IN (mỗi PR module):**

- Di chuyển rule đúng module từ `_legacy-rest.scss` → `_<module>.scss`; `@use` partial mới trong entry.
- Migrate scoped SFC của module sang `lang="scss"`; không đổi class public / selector e2e.
- Chỉ declaration rearrange + nesting tương đương.

**OUT (mỗi PR module):**

- Không sửa module khác; không redesign; không gộp hai module.

**AC (mỗi PR module):**

- [ ] `_legacy-rest` không còn rule của module đó.
- [ ] E2E capture mode tương ứng đính evidence.
- [ ] Diff review được: chủ yếu move + `lang="scss"`.

### PR backlog (tuỳ chọn, sau khi hết module)

- Stylelint; cân nhắc Playwright `toHaveScreenshot` cho shell/token.
- Responsive mobile — **epic UI riêng**, không gộp vào migrate SCSS.
- (Tuỳ chọn) siết ESLint `vue/block-lang` cho `style: scss` khi chốt “SCSS-only cho style mới”.
- Xoá `_legacy-rest.scss` khi đã trống.

---

## 8. Thứ tự thực hiện đề xuất

1. Merge **PR 0** (docs khảo sát) → chốt hướng trên issue tracking.
2. Merge **PR chung** vào `dev/1.0.0/main`.
3. Mở song song (hoặc tuần tự) các **PR module**, mỗi branch từ `dev/1.0.0/main` mới nhất.
4. Ưu tiên module còn block global lớn trước nếu muốn giảm `_legacy-rest` nhanh: `monitor` → `pipeline-editor` → `agent-editor` → `knowledge`; các module scoped-only (`runner`, `logs`, `quick-action`, `shared-ui`) làm bất kỳ lúc nào sau PR chung.
5. PR backlog khi `_legacy-rest` đã hết / gần hết.

---

## 9. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|------------|
| Visual regression khi split file | PR chung + từng PR module cấm đổi declaration; e2e capture đúng mode của PR |
| Conflict giữa PR module | Mỗi PR chỉ đụng partial/SFC module mình; base chung từ `dev/1.0.0/main` sau PR chung |
| Module PR mở trước khi chung merge | Chặn: không mở PR module cho đến khi PR chung đã vào `dev/1.0.0/main` |
| Trùng SCSS `$` vs CSS `var` | Quy ước §5.1; review checklist PR |
| Conflict với epic UI khác | Tránh cùng lúc sửa cùng region `style` / SFC; ưu tiên merge hoặc tạm dừng PR SCSS module đó |
| Build chậm / dep native | Dùng `sass-embedded`; chỉ devDependency |
| Agent thêm style sai chỗ | Doc §5; sau PR chung style mới → partial đúng module hoặc scoped SFC |

---

## 10. Tác động tooling dự kiến

| Hạng mục | Tác động |
|----------|----------|
| `package.json` / `bun.lock` | + `sass-embedded` (PR chung) |
| Vite | Không bắt buộc config thêm nếu dùng default preprocessor |
| Prettier | Tiếp tục format `.scss` / SFC; không đổi policy |
| ESLint | Tuỳ chọn PR backlog: `vue/block-lang` cho `style` |
| Vitest | Thường không đổi; mock CSS vendor giữ nguyên |
| Playwright | Không bắt buộc spec mới; **bắt buộc capture** mode của từng PR module |
| `docs/architecture.md` | Đã có §3.3 trỏ tài liệu này; cập nhật đường dẫn entry SCSS khi PR chung land |

---

## 11. Điều kiện mở lại / đổi hướng

- Chọn **B** thay **C** nếu review từ chối thêm Sass nhưng vẫn muốn tách file (vẫn giữ chiến lược **PR chung + PR/module**, base `dev/1.0.0/main`).
- **Trì hoãn** nếu sắp redesign shell/token — làm redesign trước, SCSS sau (tránh migrate hai lần).
- Mở lại khảo sát nếu đổi hẳn sang utility-first (Tailwind…) — đó là epic styling khác, không phải tiếp nối plan này.
