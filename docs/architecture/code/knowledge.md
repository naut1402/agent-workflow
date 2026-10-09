# Knowledge — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/knowledge/`. Chỉ ghi phần không tự giải thích được qua tên file. Khi sửa, đối chiếu lại với code thật.

---

## 1. Vòng import trong `business/`

- **Vòng ba cạnh** — `fileDriver ↔ collections`, và `fileDriver → tags → knowledgeDb → fileDriver` (`knowledgeDb` cần `resolveBases` để dựng `store_key`).
- **Chỉ tham chiếu trong thân hàm** — ESM giải được vòng vì không module nào đọc binding của vòng lúc evaluate. Thêm một lời gọi ở top level của bất kỳ module nào trong vòng là hỏng ngay.

## 2. Scope, base và `store_key`

- **Bảng tra chống traversal** — `resolveBases()` + `entryPath()` (`business/fileDriver.ts`): scope phải nằm trong `KNOWLEDGE_SCOPES`, base lấy bằng tra bảng `scope → base`; không bao giờ nối `scope` client gửi vào path. `resolveBases()` không mkdir: thư mục scope chưa có thì `walkEntries` coi như rỗng, đường ghi đã có `writeTextFileAtomic` tạo thư mục cha.
- **Scope nằm trong id** — id entry là `<scope>/<slug>`, nên `KNOWLEDGE_SCOPES` (`schemas/knowledge.ts`) chỉ được thêm giá trị; đổi giá trị cũ là đổi id mọi entry. Khi đọc, scope suy từ thư mục chứa file thắng `fm.scope` (`parseEntryFile`), vì thư mục mới quyết định đường dẫn thật.
- **`store_key` = đường dẫn store base** — `storeKeysOf()` (`business/knowledgeDb.ts`): `<root>/knowledge` cho `project` / `system`, `globalKnowledgeRoot()` cho `global`. `src/backend/db/migrateKnowledge.ts` dựng đúng khoá này khi nạp `collections.yaml`; đổi công thức là collection đã migrate không còn hiện.

## 3. Slug khi tạo mới

- **`slugify` trước `sanitiseSlug`** — `sanitiseSlug` băm nát tiếng Việt (`Giảm số token` → `gi-m-s-token`), nên slug entry mới (`write()` không có `id`) và id collection (`createCollection`) đi qua `slugify` (NFD + map đ→d). Upload lấy title từ tên file, không từ slug.
- **Hậu tố chống trùng** — `uniqueSlug()` thêm `-<4 hex>` chỉ khi trùng. Phần thân cắt sẵn về `SLUG_MAX - SLUG_SUFFIX_LEN` vì `entryPath` lại `sanitiseSlug` và cắt về `SLUG_MAX`: ghép hậu tố vào seed sát trần thì front-matter `slug` lệch tên file, hoặc mọi candidate bị cắt về chính seed và vòng lặp không tìm ra chỗ trống.
- **`finalSlug` tính đúng một lần** — `write()` dùng chung một giá trị cho `entryPath` và `serialiseEntry`; tính riêng ở mỗi bên sẽ lệch nhau sau khi có hậu tố. Đường sửa (có `id`) lấy slug từ `id`, bỏ qua `slug` client gửi.

## 4. Front-matter của người dùng

- **Giữ khoá lạ** — `write()` chỉ ghi các khoá trong `KNOWN_FM_KEYS`; `readExtraFm()` đọc lại phần dư từ bản đang có trên đĩa rồi ghi kèm. Bỏ bước này thì `renameTag` (ghi lại mọi entry mang tag) xoá khoá người dùng tự thêm trên diện rộng chỉ bằng một request.
- **Gán tag nằm ở front-matter** — bảng `knowledge_tags` chỉ giữ metadata (màu, mô tả); quan hệ tag ↔ entry vẫn là field `tags` của file `.md`.

## 5. Đường đọc an toàn và facet tag

- **Đường đọc entry không chết vì DB** — `findCollectionSafe`, `decorateTagFacets`, `readTagAliasesSafe` nuốt lỗi DB (mất phần nhóm / màu / alias, danh sách entry vẫn đọc từ file). Đường đọc collection và mọi đường ghi thì ném `KnowledgeDbError` — [`../README.md`](../README.md) §4.4.
- **Facet đếm trước khi lọc** — `listWithTags()` đếm tag trên tập đã lọc scope nhưng trước tag / query / collection; đếm sau thì chọn một tag làm mọi tag khác về 0. Facet kèm cả tag chỉ có trong DB (`count: 0`), nên panel nạp facet qua `?include=tags`, không gọi thêm `/api/knowledge/tags`.
- **Alias khi lọc** — `?tags=` đi qua `resolveTagAliases()` (theo chuỗi alias, trần 8 bước để alias vòng không treo request), để link lọc cũ vẫn đúng sau khi đổi tên tag.

## 6. Đổi tên tag

- **File trước, DB sau** — `renameTag()` (`business/collections.ts`) rewrite front-matter từng entry trước (chạy lại an toàn: entry đã đổi không còn `from`), rồi ghi alias + metadata tag + tag của collection trong một transaction. Không có transaction xuyên file + DB; hỏng ở bước DB thì chạy lại lệnh là đủ. Hỏng giữa chừng ở bước file thì dừng tại entry đó và trả `entries` đã xong.
- **Phạm vi DB là mọi store** — bước DB chạy trên mọi `store_key`, không chỉ store có entry bị chạm: tag 0 entry là trạng thái hợp lệ, bám theo entry đã chạm thì alias + metadata không được ghi trong khi hàm vẫn trả `alias`. Metadata dời bằng `moveTagMetaInTx()` (`business/tags.ts`) trong cùng transaction (`KnowledgeTx`); để client tự `PUT` thì hàng tên cũ sót lại, hiện mãi với `count: 0`.
- **Dialog: rename rồi mới `PUT`** — `KnowledgeTagDialog.vue` gọi `POST /tags/rename` trước (đã dời metadata sang tên mới), sau đó `PUT /tags/:tag` theo tên mới chỉ để áp màu / mô tả vừa chọn. `PUT` hỏng thì tag giữ màu cũ, dialog vẫn báo thành công kèm lỗi (`knowledge.tags.renamedNoMeta`).

## 7. Frontend

- **`projectId` xuống mọi lời gọi** — `KnowledgePanel.vue` truyền `projectId` cho mọi API: nhóm và tag có đường ghi hàng loạt (`renameTag`, `deleteCollection`), chạy nhầm root là hỏng dữ liệu project khác.
- **Ghi đúng store của tag** — `KnowledgeTagDialog.vue` gửi lại `scope` của store đang giữ metadata (`KnowledgeTagFacetView.scope`); ghi sai store thì tag `global` đẻ thêm hàng `project` cùng tên, và màu hàng mới đè màu `global`.
- **Quirk layout** — `<button>` trong `<summary>` vẫn toggle `<details>`, nên nút `+` ở `KnowledgeSideMenu.vue` cần `@click.stop.prevent`. `.knowledge-content-label` (`KnowledgeFormDialog.vue`) giữ `flex: 0 0 auto`: với `flex: 1` label co được dưới chiều cao editor Toast UI và editor tràn đè hàng nút.
