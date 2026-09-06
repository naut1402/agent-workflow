# Feature architecture guideline

Quy tắc đặt code vào đúng feature / đúng tầng. Bản đầy đủ cho người đọc: `docs/implement/feature-organization-rule.md`, `docs/cookbook/core-path-reorg.md`.

- Feature là **đơn vị ownership**, không phải tầng kỹ thuật. Cross-cutting thật sự (audit log, registry) → `core`; đọc/ghi nghiệp vụ của một domain → feature sở hữu domain đó.
- Primitive đặt ở `core`, orchestration đặt ở feature.
- Phụ thuộc **một chiều**: `lib` / `configs` → `business` → `controller` → `api`.
- Không có file "god routes": route đăng ký qua `features/<name>/api.ts`; **không** sửa registry của `apiServer` bằng tay.
- Feature không gọi feature khác qua tầng HTTP. Peer chỉ dùng nhau qua `business/index.ts`; import sâu chỉ khi barrel tạo vòng phụ thuộc.
- Sanitize / rule của domain gắn vào **feature sở hữu**, không nhét vào `core`.
- Ai validate biên I/O thì giữ file Zod. `core` phải import `features` để lấy schema là dấu hiệu đặt sai chỗ.
- `core/log` (ghi + driver) khác feature `logs` (đọc / UI) — đừng gộp.
- Chia `business/` theo **nghiệp vụ đang xử lý**, không theo loại thao tác kỹ thuật. Tách module khi biên capability đã rõ **hoặc** khi file quá lớn để review.
- App root chỉ **wire**; cơ chế auto-load nằm ở helper trong `core/lib`, không phình `apiServer`. Mọi cơ chế auto-load phải có đường dự phòng và đường đó phải có test.
- Plugin = thư viện app-scope (i18n…); feature = nội dung. Module augmentation gom về một chỗ.
- Xoá cây cũ ngay khi không còn import trỏ tới — không để "hai nhà" cho cùng một thứ.
- Thêm feature mới: theo checklist 9 bước ở `docs/cookbook/core-path-reorg.md` § *Checklist khi thêm feature mới*.

Nguồn: `docs/implement/feature-organization-rule.md`, `docs/cookbook/core-path-reorg.md`.
