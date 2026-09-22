# Quy ước — chi tiết nào thuộc cấp nào trong tài liệu kiến trúc

Áp dụng khi viết hoặc sửa bất kỳ file nào trong `docs/architecture/`. Quyết định **một thông tin được phép đặt ở cấp nào** — đặt sai cấp là lỗi, không phải chuyện thẩm mỹ.

Toàn bộ `docs/architecture/` viết theo **C4 model** của Simon Brown: [c4model.com](https://c4model.com) (và sách *Software Architecture for Developers*, cùng tác giả). Nguồn dẫn chứng cho từng cấp lấy trực tiếp từ trang chính thức, mục `Diagrams` — mỗi cấp có 1 nguyên lý cốt lõi + nguyên tắc áp dụng cụ thể vào repo này.

---

## Cấp 1 — System Context

**Nguyên lý** (dẫn chứng: [c4model.com/diagrams/system-context](https://c4model.com/diagrams/system-context)):

> "Draw a diagram showing your system as a single box in the centre, surrounded by the people (actors, roles, personas) and other software systems that it interacts with... The other software systems and people are shown as boxes too, but we don't need any more information about these other than their name and maybe a brief description... They should be treated as 'black boxes' — we don't want to show any internal implementation detail."

**Nguyên tắc áp dụng vào repo này:**

- Hệ thống đang mô tả (`dev-team-dashboard`) là **1 hộp duy nhất, ở giữa**.
- Actor (Dev/PM) và hệ thống ngoài (orchestrator, AI provider, GitHub, Claude CLI) là **black box** — chỉ tên + mô tả 1 dòng, **không** đề cập cấu trúc nội bộ của chúng.
- Đối tượng đọc **rộng, kể cả phi kỹ thuật** — hạn chế thuật ngữ công nghệ trong mô tả quan hệ; nhãn công nghệ trên `Rel` (`HTTPS`, `MCP stdio`, …) là **tuỳ chọn**, chỉ thêm khi giúp rõ nghĩa, không bắt buộc.
- **Cấm** nhắc tới file, module, hay đường dẫn source cụ thể (`.dev-state/*.json`, `mcp/server.ts`, `src/features/...`) — đó là chi tiết Container/Code, rò rỉ vào Context là vi phạm nguyên tắc black-box.

---

## Cấp 2 — Container

**Nguyên lý** (dẫn chứng: [c4model.com/diagrams/container](https://c4model.com/diagrams/container)):

> "A Container diagram shows the high-level shape of the software architecture and how responsibilities are distributed across it. It also shows the major technology choices... A 'container' is something like a server-side web application, single-page application, mobile app, desktop application, database schema, file system, etc. Basically, a container is a separately runnable/deployable unit that executes code or stores data."

**Nguyên tắc áp dụng vào repo này:**

- Một thứ được xếp vào Container **chỉ khi** nó build/deploy/chạy **độc lập**: Frontend SPA, Backend app (2 transport), MCP server, `dashboard.sqlite`, data root filesystem.
- **Công nghệ chính** của mỗi container được phép nêu ở cấp này (Vue 3 + Vite, Hono trên Bun/Node, SQLite + Drizzle) — khác Context, đây là nơi bắt đầu lộ tech stack.
- Quan hệ giữa các container mô tả **giao thức/kênh** (REST + SSE, Drizzle ORM, stdio) nhưng vẫn **không** lộ internal component/class bên trong từng container.
- **Không** nêu tên hàm/export nội bộ (vd hàm resolve root, hàm mount handler) — đó là Code-level, dù nó "giải thích" cho hành vi container. Container chỉ mô tả *có 2 run mode*, *có 1 shim tương thích* — không cần tên hàm nào implement chúng.
- **Bất biến kiến trúc không đặt ở đây.** Nội dung thật của nó là tên hàm/file sanitize cụ thể (`fileHelper.resolvePathUnder`, `sanitiseProfileName`, …) — đúng bản chất Code, nên đặt ở cấp 4 dù nó là *ràng buộc* áp dụng lên container. "Là ràng buộc khi deploy" không đủ để xếp vào Container nếu nội dung diễn đạt nó vẫn ở mức tên hàm/file.

---

## Cấp 3 — Component

**Nguyên lý** (dẫn chứng: [c4model.com/diagrams/component](https://c4model.com/diagrams/component)):

> "The Component diagram zooms into an individual container to show the components inside it... A 'component' is a grouping of related functionality encapsulated behind a well-defined interface... Components are not deployable units."

Brown cũng cảnh báo trực tiếp trong cùng trang: tài liệu Component **dễ lỗi thời** nếu vẽ tay chi tiết, và nhiều team **bỏ qua cấp này** hoặc chỉ sinh tự động từ code — không khuyến khích liệt kê thủ công từng file/class.

**Nguyên tắc áp dụng vào repo này:**

- Mỗi mục ở cấp này là **một nhóm trách nhiệm** bên trong 1 container (vd tầng HTTP, event bus, config shell, 1 mode FE) — **không phải** danh sách file/class.
- Chỉ ghi lại **hành vi không hiển nhiên từ tên thư mục** (vd orchestrator opt-in, statistics có giới hạn theo driver) — phần liệt kê đầy đủ feature/file trỏ thẳng vào `src/` thay vì lặp lại trong doc (tránh đúng rủi ro Brown cảnh báo: tài liệu lỗi thời so với code).
- Không đặt tên component/class cụ thể (trừ khi bản thân tên đó **là** danh tính kiến trúc ổn định, ví dụ `ModeRegistry`, `AbstractController` — những khái niệm ít đổi qua refactor).

---

## Cấp 4 — Code

**Nguyên lý** (dẫn chứng: [c4model.com/diagrams/code](https://c4model.com/diagrams/code)):

> "The Code diagram... shows how a particular component is implemented, using something like a UML class diagram... Given the ability for modern IDEs and other tooling to visualise the code... and the fact that this level of detail is rarely needed, we don't recommend this level of diagramming... Only diagram it for your most important components."

**Nguyên tắc áp dụng vào repo này:**

- Đây là cấp **duy nhất được phép** nêu tên file, hàm, bảng schema, đường dẫn cụ thể — đúng bản chất "code-level detail". Bất biến kiến trúc (tên hàm/file sanitize cụ thể) đã thành checklist review ở `AGENTS.md` §6, không đặt ở cấp này.
- Vì Brown đã cảnh báo cấp này **rỗng giá trị nếu tách rời code** và **luôn có nguy cơ lỗi thời**, `architecture/README.md` §4 ghi rõ ngay đầu: *"cấp thay đổi thường xuyên nhất — khi sửa, đối chiếu lại với code thật thay vì tin nội dung cũ"*.
- Chỉ document phần **không tự giải thích được qua tên file** (quirk, giới hạn đã biết, thứ tự migration, lý do giữ `.js`) — không chép lại toàn bộ cấu trúc source (source đã tự mô tả qua tên file/folder).

Tài liệu áp dụng quy ước này: [`docs/architecture/`](../architecture/README.md). Quy ước trình bày markdown dùng chung: [`writing-guideline.md`](../agent-rules/writing-guideline.md) §2.
