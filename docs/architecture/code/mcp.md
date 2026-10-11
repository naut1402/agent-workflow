# MCP — chi tiết cấp Code

Cấp **Code** của [`../README.md`](../README.md) §4 cho feature `src/features/mcp/` (vai client) và tiến trình `mcp/` (vai server). Chỉ ghi phần **không tự giải thích được qua tên file**: quirk, giới hạn đã biết, ràng buộc ẩn. Hợp đồng và cấu hình cho người dùng ở [`docs/mcp/`](../../mcp/README.md) — trang này không chép lại. Khi sửa, đối chiếu lại với code thật.

---

## 1. `McpClient.ts` — vòng đời phiên và ngân sách thời gian

- **`probe`: `timeoutMs` là ngân sách cho cả lượt** — `connect` và `tools/list` chia chung một deadline (`remainingMs`). Cấp trọn `timeoutMs` cho mỗi bước thì nút *Kiểm tra kết nối* (không huỷ được) có thể đứng tới 2× timeout — 4 phút với mặc định 120s. Hết ngân sách thì `remainingMs` trả 0 và `withTimeout` bỏ cuộc ngay.
- **`open` (phiên theo job của họ `ai-api`) luôn gọi `tools/list`** — bỏ qua `opts.listTools`: phiên sinh ra để nối tool vào vòng tool-use. Muốn chỉ thử kết nối thì dùng `probe`.
- **Đóng client ở mọi đường** — `probe` đóng trong `finally`; `open` mở hụt thì đóng ngay trước khi ném, vì caller nhận exception và không có handle nào để gọi `close()`. Phiên mở thành công thì caller gọi `McpSession.close()` trong `finally`. Transport stdio là một tiến trình con: quên đóng là rò tiến trình theo từng job.
- **`onWarning` là callback, không chỉ nằm trong giá trị trả về** — cảnh báo quan trọng nhất (`credential … không giải được secret — bỏ header xác thực`) sinh ra *trước* `connect()`, và chính nó làm `connect()` ném 401/timeout. `open` đẩy cảnh báo ra trước `connect()`; đường trả về không bao giờ chạy ở đúng ca cần giải thích nhất.
- **`McpProbeTool.inputSchema` chỉ `open` điền** — kết quả `probe` trả qua `POST /api/mcp-servers/test` và được persist vào `lastCheck`; schema tool là payload lớn không ai đọc ở đó. Vòng tool-use thì bắt buộc có nó.
- **`probe` và `open` dùng chung `McpServer.createTransport`** — guard endpoint, danh sách mask và env của phiên giống hệt đường probe, không có bản thứ hai để lệch.
- **Tên client = `SelfMcpServer.SERVER_ID`** — dashboard tự xưng cùng một tên ở cả hai vai. Import `SelfMcpServer` không thành vòng: `SelfMcpServer` → `StdioMcpServer` → `McpServer` không import `McpClient.ts`.

## 2. `McpRegistry.ts` — store và chọn server cho job

- **Migrate v1 → v2 (`migrateToV2`)** — giới hạn ở [`docs/mcp/client.md`](../../mcp/client.md) §8. Chi tiết:
  - Bỏ `timeoutMs` ở **mọi** bản ghi v1 có giá trị `< MCP_DEFAULT_TIMEOUT_MS`, không riêng mặc định cũ `15000`: người đặt `30000` ở v1 chọn «probe chờ 30s», chưa từng chọn «job cho server 30s để khởi động».
  - Giá trị `≥ 120s` (file sửa tay — đường đọc không kẹp) được giữ: nó chỉ làm job chờ lâu hơn mặc định, xoá là vứt một con số người dùng cố ý ghi.
  - Version thiếu / sai kiểu / `0` coi như v1. `MCP_SERVERS_VERSION` tồn tại để phân biệt «`15000` là mặc định cũ» với «`15000` người dùng đặt sau khi lên v2».
  - Chạy ở đường đọc nên idempotent; file chỉ lên `version: 2` ở lần ghi kế tiếp.
- **Schema bản ghi không phải cổng parse của đường đọc** — `McpServerConfigSchema` (`schemas/mcpServer.ts`) mô tả shape *sau* `McpRegistry.normalise`. Luật bỏ bản ghi hỏng nằm ở `StdioMcpServer.normalise` / `RemoteMcpServer.normalise` (§7).
- **`select` nối `extras` sau `servers`** — `McpServerSet.toCliConfig` ghi theo thứ tự nên trùng khoá thì entry tự gắn của dashboard thắng. Cảnh báo ghi đè so trên khoá **đã sanitise** (`server.key`), vì file dedup theo khoá đó: id `dev-team-dashboard!` sanitise về đúng `dev-team-dashboard` và bị ghi đè thật, so id thô sẽ bỏ sót.
- **`save` không chmod `registryHome()`** — thư mục dùng chung cho mọi feature; mode `0600` của chính file đủ chặn đọc. Bản sao theo job của cùng các secret cũng `0600` (`ConfigFlagMcpDelivery` ở `runner`).

## 3. `McpServer.ts` — id, đích kết nối và `env:NAME`

- **`sanitiseId` là bản sao cố ý của `sanitiseRunnerId`** (`runner/business/types.ts`) — để `mcp` không phụ thuộc `runner`. Đổi luật ở một bên thì đổi cả bên kia.
- **`destination()` tính trên giá trị thô, không mask** — đây là cổng chặn đọc secret qua *Kiểm tra kết nối*. Mask hai vế thì mọi arg đứng sau một cờ mang tên secret (`--auth`, `--token`, …) thành `***` ở cả hai bên, đổi *giá trị* của nó không còn làm đích khác đi. Ca cụ thể: đã lưu `--auth https://internal --token sk-REAL`, gửi lên `--auth https://attacker --token ***` ⇒ mask hai vế bằng nhau ⇒ khôi phục `sk-REAL` rồi probe tới host của người gửi. Ca «bản nháp mang `***` nên không khớp» xử lý ở caller (§9).
- **`resolveEnvRefs`: biến chưa đặt thì bỏ hẳn khoá** — kèm cảnh báo. Ghi literal `env:NAME` xuống server con còn tệ hơn thiếu biến, vì nó trông như một token hợp lệ.
- **Biến đổi trả bản mới cùng lớp** — `restoreMasked` / `withLastCheck` đi qua `rebuild`, nên không làm đổi hiện thực; chỉ `McpRegistry.normalise` biết chọn lớp nào.

## 4. `McpServerSet.ts` — `toCliConfig`

- **Shape khoá đã xác minh trên Claude Code 2.1.267** (`claude mcp add-json`): `type` nhận `stdio` / `sse` / `http` (`streamable-http` là bí danh, CLI chuẩn hoá về `http`); entry có `url` bắt buộc khai `type`; entry stdio suy được `type` từ `command` nhưng khai tường minh vẫn hợp lệ; không có khoá `cwd` — server con kế thừa cwd của tiến trình `claude`.
- **Trùng khoá thì bản ghi sau thắng** — entry tự gắn đứng cuối (§2).
- **`names` — một tên cho mỗi entry thật trong file** — id trùng khoá chỉ đếm một lần (báo 2 là báo sai thứ job nhận), server có `key` `null` không vào file nên không được đếm. Tên hiển thị là id **người dùng gõ**, không phải khoá đã sanitise, để khớp tab MCP; khoá trùng thì lấy id của server thắng.

## 5. `RemoteMcpServer.ts` — `guardedFetch` và header

Chính sách endpoint (`https` mọi host, `http` chỉ loopback/private) ở [`docs/mcp/client.md`](../../mcp/client.md) §4. `guardedFetch` tự đi từng hop (`redirect: 'manual'`) thay vì để runtime đi hộ:

- **Guard chạy lại ở mọi hop** — `assertEndpoint` chỉ chạy trên URL người dùng khai; với `redirect: 'follow'` mặc định, một server `https` hợp lệ trả 302 sang `http://attacker.example` là vòng qua chính sách endpoint. Tối đa `MAX_REDIRECT_HOPS` = 3 hop (đủ cho `/mcp` → `/mcp/` → canonical host), hơn nữa là vòng lặp.
- **Đổi origin ⇒ bỏ sạch header tiêm** — header người dùng đặt (`Authorization`, `X-API-Key`, …) không được bám theo redirect sang origin lạ. Origin chốt theo **URL người dùng khai**, không theo hop trước: A → B → A không khôi phục header.
- **Bỏ `injected` là chưa đủ** — SDK đã gộp sẵn header của ta vào `init.headers` (`_commonHeaders()` trong `client/streamableHttp.js`, `client/sse.js`), nên phải lọc cả phần kế thừa theo tên khoá (`ownKeys`, so chữ thường — `Headers` chuẩn hoá về chữ thường còn người dùng gõ `X-API-Key`).
- **`mcp-session-id` bỏ khi đã rời origin gốc** — định danh phiên do origin gốc cấp; cùng origin thì SDK bắt buộc echo lại.
- **Dựng header bằng `Headers`, không object spread** — spread `init.headers` (chữ thường) với `injected` (dạng người gõ) để lại hai khoá và `fetch` gửi `"tok, tok"`; server so khớp chặt sẽ từ chối.
- **3xx không `Location` (hoặc `Location` hỏng) trả nguyên cho SDK.** 307/308 giữ method + body; body không phải chuỗi / `Uint8Array` có thể là stream đã tiêu thụ nên không đoán — trả thẳng 3xx. 301/302/303 chuyển sang `GET` không body.
- **Huỷ body của 3xx trước khi đi tiếp** — không thì rò socket.
- **Header đi cả `requestInit` lẫn `fetch`** (`createTransport`) — `requestInit` chỉ áp cho POST; stream GET của SSE lấy `fetch` ở tuỳ chọn gốc.

## 6. `SecretMasker.ts` — nhận diện và che secret

- **Node-free** — FE import thẳng file này để dialog dùng chính quy tắc nhận diện secret của backend; không import `node:*` hay SDK MCP.
- **Secret trong `args` (`secretArgs`) chỉ ba dạng**: giá trị đứng ngay sau một cờ mang tên secret (`--token sk-…`, và giá trị không bắt đầu bằng `-` — `--token --verbose` là cờ bỏ trống); dạng gộp `--token=sk-…`; giá trị tự mang hình dạng token đã biết (`sk-`, `ghp_`, JWT, …). Không dùng ngưỡng `isMaskable`: 8 ký tự nuốt cả `@modelcontextprotocol/server-filesystem` và mọi đường dẫn. Sentinel `***` / `--flag=***` không tính là secret — không thì mọi vòng «lấy về đã mask → Lưu» báo động giả.
- **Hai ngưỡng khác nhau là có chủ ý** — `maskArgs` (đường API) không lọc `isMaskable`: thà che hụt độ dài còn hơn để lộ. Danh sách mask **log** lọc `isMaskable` ở chỗ dựng (`McpServer.secretValues`, …), vì thay một chuỗi < 8 ký tự làm log không đọc được; bản thân `SecretMasker` nhận gì che nấy.
- **`mask` thay theo thứ tự dài → ngắn** — một secret là tiền tố của secret khác thì thay cái ngắn trước sẽ để lộ đuôi (`abcdefgh` biến `abcdefghXYZ` thành `***XYZ`).
- **`maskDeep`** — kết quả tool đi thẳng vào log job và `messages` được persist, nên phải che trước khi rời tiến trình; áp cho cả họ `ai-api`, không riêng agent CLI (ở đó `maskLog` của `AbstractAgentCliProvider` lo phần tương ứng). File đặt ở `mcp/business/` để cả hai họ provider dùng chung.
- **`stream()` có trạng thái** — `mask` là split/join không trạng thái, nên secret bị tiến trình con xuất làm hai chunk (`"sk-test-LEAK"` + `"CANARY"`) lọt qua. Bộ lọc giữ ít nhất `max(len(secret)) - 1` ký tự thô ở cuối buffer; điểm cắt rơi giữa một secret thì lùi về đầu secret.
  - **Đánh đổi**: log stream trễ phần đuôi tới chunk sau hoặc `flush()`. Caller phải `flush()` ở cả nhánh lỗi — không thì nuốt mất đúng đoạn cuối người dùng cần để biết job hỏng vì sao.
  - **`hasSecret` tách khỏi `keep === 0`** — `keep === 0` có thể là «không có secret» hoặc «secret dài nhất đúng 1 ký tự»; gộp lại thì ca sau trả chunk chưa mask. Hôm nay bất khả (caller lọc qua `isMaskable`), nhưng bỏ bộ lọc ở caller là mất mask mà không test nào đỏ.
  - Không secret nào ⇒ không buffer, không trễ.

## 7. `StdioMcpServer.ts` — chuẩn hoá, khôi phục `args`, env của probe

- **Guard `command` rỗng ⇒ `null` nằm ở `StdioMcpServer.normalise`**, không nâng lên lớp cha (tương tự guard `url` của `RemoteMcpServer.normalise`). Nâng lên là đổi thứ tự kiểm tra, tức đổi cái gì được coi là cấu hình hợp lệ — mọi bản ghi đọc từ đĩa đi qua đây.
- **`args === undefined` giữ nguyên `undefined`** qua `masked` / `restoreMasked` — hoá thành `[]` là làm hỏng bất biến round-trip `restoreMasked(masked(s), s) === s`.
- **`restoreMaskedArgs` cần neo** — `args` không có khoá để ghép, chỉ có vị trí; người dùng chèn/xoá một arg phía trước là mọi ô sau lệch đi một, khôi phục theo vị trí lệch là ghi secret của tham số này vào tham số khác. Neo theo dạng mask:
  - `--flag=***` ⇒ `previous[i]` phải bắt đầu bằng đúng `` `${flag}=` ``.
  - `***` ở `i > 0` ⇒ `maskArgs(previous)[i - 1]` phải trùng `next[i - 1]` và bản cũ phải có secret ở đúng vị trí `i`.
  - `***` ở `i === 0` ⇒ không có cờ để neo, nên neo bằng «bản cũ cũng giữ secret ở ô 0» (`secretArgs` nhận secret theo hình dạng giá trị ở mọi vị trí — thiếu nhánh này thì `['ghp_…', '--repo', 'o/r']` mất token sau mỗi vòng sửa-lưu). Chèn arg phía trước vẫn chặn được: `next[0]` khi đó là arg mới, ô `***` trôi xuống `i > 0`.
  - Neo không khớp ⇒ **bỏ hẳn** phần tử và phát `WARN_ARGS_SECRET_DROPPED`. Không ghi literal `***` xuống server con: thiếu tham số thì server báo lỗi rõ, `***` thì nó im lặng chạy sai.
- **`warnings()` không làm bằng `.superRefine` của schema** — mọi issue Zod làm `safeParse` thất bại, biến cảnh báo thành 400: server đang chạy với secret literal trong `args` bỗng không Lưu lại được. Cảnh báo đi kèm response 2xx, người dùng tự quyết có chuyển sang credential profile không.
- **Probe dùng full `process.env`** (`fullProcessEnv`), không `getDefaultEnvironment()` (6 biến) của SDK — job thật spawn `claude` với `{...process.env}` và CLI truyền nguyên env đó xuống MCP server; probe hẹp hơn là probe một cấu hình khác cấu hình sẽ chạy. `server.env` spread sau nên thắng khi trùng khoá.
  - **Hệ quả cho danh sách mask** — server con giờ thấy cả `ANTHROPIC_API_KEY` / `DASHBOARD_SECRET_KEY` của host; nó vọng giá trị nào vào thông điệp lỗi thì chuỗi đó ra dialog và bị persist vào `lastCheck.error`. Nên mask thêm giá trị của host, lọc theo **tên khoá** (`looksLikeSecretLiteral`), không theo `isMaskable` — ngưỡng độ dài nuốt cả `PATH` / `HOME` / `PWD`.
- **`startupTimeoutSec`** — miền và cách kẹp ở [`docs/mcp/client.md`](../../mcp/client.md) §7. Server không khai `timeoutMs` ⇒ entry không có khoá này (ghi `null` thì CLI từ chối entry). Hai cảnh báo khác nhau: ngoài miền `[5s, 600s]` kiểm trên giá trị **ms gốc** (4999ms là dưới sàn thật); trong miền nhưng không tròn giây ⇒ cảnh báo làm tròn — nói «ngoài miền» cho 7500ms là sai.

## 8. `SelfMcpServer.ts` — entry tự gắn cho job điều phối

Hằng hợp đồng xuyên process và ràng buộc không side effect lúc nạp ở [`docs/mcp/server.md`](../../mcp/server.md) §8.1; cách job nhận entry ở [`docs/mcp/client.md`](../../mcp/client.md) §7.

- **Guard duy nhất `orchestratorEnv`** — job điều phối (`orchestratorJob === true`), có `orchestratorToken` dạng chuỗi, và `selfBaseUrl()` có giá trị. `childEnv` và `forJob` cùng đọc nó, nên không bao giờ có job mang tool `orchestrator_decide` mà thiếu token của tool đó.
- **`canAttach()`** — định vị được `mcp/stdio.ts` từ `business/` lên bốn cấp tới gốc app; `mcp/` nằm cạnh `src/` cả trong repo lẫn trong image (`docker/Dockerfile`). `resolveDecisionRoute` đọc đúng hàm này để chốt tuyến (xem [`orchestrator.md`](orchestrator.md) §1), nên prompt không dạy agent gọi một tool không tồn tại.
- **`SERVER_ID` trùng id server người dùng ⇒ entry tự gắn thắng** — job điều phối phải chắc chắn nói chuyện với dashboard này (§2).
- **`TOKEN_HEADER` không dùng `Authorization`** — `createJwtMiddleware()` đọc header đó cho JWT dashboard và sẽ chặn nhầm.
- **`selfBaseUrl()` trả nguyên văn, không trim** — caller tự quyết: `resolveDecisionRoute` trim (khoảng trắng ⇒ `sentinel`), `childEnv` thì không.
- **Constructor `private`** — chỉ `forJob` dựng được; entry tự gắn không bao giờ đọc từ đĩa hay từ API.
- **Entry của `forJob`**:
  - `command` = `process.execPath`, không chuỗi `'bun'` — job có thể chạy với PATH khác hẳn tiến trình dashboard.
  - `--mode=full` đi qua argv vì `resolveMode` đọc argv trước env — mode không phụ thuộc việc CLI bên thứ ba có để `env` của entry thắng env kế thừa hay không. Thiếu `full` thì `orchestrator_decide` (access `write`) vắng khỏi `tools/list` và tuyến `mcp` hỏng trong im lặng.
  - `env` **tối thiểu** — mọi giá trị env của entry stdio đi qua `secretValues()` → `isMaskable` (≥ 8 ký tự, không phân biệt secret với đường dẫn), mỗi khoá thêm vào là một chuỗi bị thay `***` ở mọi dòng log của job điều phối. Vì thế không khai `DEV_TEAM_ROOT` / `DEV_TEAM_DASHBOARD_HOME`: tiến trình MCP là con của CLI, CLI là con của dashboard, nên kế thừa được. `DEVTEAM_MCP_MODE=full` là lưới thứ hai cho mode (4 ký tự, dưới ngưỡng mask); token và base URL đổi tên so với biến của tiến trình cha nên phải khai — token là secret thật, bị mask là đúng ý.

## 9. `controller.ts` — Lưu và *Kiểm tra kết nối*

- **`upsertServer` kiểm endpoint trên URL thô, trước `normalise`** ([`docs/mcp/client.md`](../../mcp/client.md) §4) — `normalise` cắt khoảng trắng và trả `null` cho URL rỗng, kiểm sau nó là đổi thông điệp lỗi người dùng nhận (`mcp: invalid URL` thành `invalid mcp server config`).
- **Cảnh báo của Lưu tính trên bản đã lưu** (`result.server.warnings()`), không trên payload: payload mang `***` ở ô người dùng không sửa, tính trên nó là bỏ sót đúng ca «secret thật vẫn đang nằm trong `args`».
- **`testServer` so đích trên bản đã khôi phục** — luật «chỉ khôi phục `***` khi bản nháp còn trỏ đúng đích đã lưu» ở [`docs/mcp/client.md`](../../mcp/client.md) §5. So `destination()` của `candidate` (sau `restoreMasked`), không của bản thô: ô `***` được thay bằng đúng giá trị đã lưu nên hai vế khớp, còn ô người gửi điền giá trị mới đi thẳng vào `candidate` và làm đích khác đi ⇒ vẫn chặn (§3). So ra khác thì `candidate` bị vứt — không probe, không response nào mang nó. Đổi đích mà còn ô `***` ⇒ 400 rõ ràng, không âm thầm bỏ khoá (probe sẽ 401 và người dùng đi sửa nhầm chỗ).
- **`testWarnings` đi kèm response** — mang `argsSecretDropped` khi một ô `***` neo lệch đã bị bỏ (§7), tức probe đang chạy thiếu tham số; đánh rơi nó là người dùng nhận một lỗi không liên quan tới nguyên nhân thật.
- **`lastCheck` chỉ ghi khi `sameTarget`** — bản nháp đổi đích rồi Huỷ mà vẫn ghi thì panel hiện một trạng thái không thuộc cấu hình nào đang tồn tại.

## 10. `McpServerDialog.vue` · `McpPanel.vue` — dialog cấu hình

- **`fallow-ignore-file complexity`** — độ phức tạp của template đến từ các nhánh `v-if` theo transport (`stdio` / `http` / `sse`), không từ logic lồng sâu. Chẻ sub-component là thay đổi thiết kế, và test component + e2e đang bám cấu trúc DOM hiện tại; tách chỉ dời nhánh đi, không giảm tổng.
- **Id derive từ Tên hiển thị** — id là khoá `mcpServers` trong file config và đi thẳng vào tên tool model thấy (`mcp__<id>__<tool>`), mà `McpRegistry.upsert` chỉ nhận id đã canonical ([`docs/mcp/client.md`](../../mcp/client.md) §8). `slugify` chỉ sinh `[a-z0-9-]`, cắt `ID_MAX_LENGTH` = 64:
  - `slugify` cắt trước khi nối hậu tố, nên `withSuffix` chừa chỗ cho `-N` — nối thẳng là vượt 64, backend cắt lại thành id khác id canonical ⇒ 400.
  - `slugify` bỏ `-` hai đầu *trước* khi cắt, nên nhãn dài vẫn ra id kết thúc bằng `-`; `deriveId` bỏ nó đi.
- **Sửa: id đóng băng** — `Connection.config.mcpServers` tham chiếu server theo id, đổi id theo label là đứt mọi Connection đang trỏ tới nó.
- **Sao chép không phải sửa** — `upsert` ghi đè theo id, nên bản sao (`isCopy`) derive id lại từ label thay vì kế thừa id nguồn. `McpPanel.openCopy` chỉ đổi label, không đặt `copy.id`; trùng thì dialog tự thêm hậu tố theo `takenIds`.
- **Sao chép xoá các ô `***`** (`McpPanel.openCopy`) — bản sao mang id mới nên backend không có bản cũ để khôi phục, khoá đó bị bỏ hẳn. Để ô hiện ra rỗng (kèm `secretsCleared`): `***` trông như đã có giá trị, người dùng chỉ phát hiện khi job đầu tiên fail 401.
- **Cảnh báo `args` tính tại chỗ** (`localArgsWarnings`), không đợi API — `McpPanel` gắn dialog bằng `v-if` nên mở lại luôn là component mới (`apiWarnings` rỗng), còn `emit('close')` huỷ component ngay trong cùng tick nên cảnh báo gán sau Lưu không kịp vẽ.
  - Dùng chính `SecretMasker.secretArgs` của backend để hai tầng không lệch ngưỡng — không thay bằng `looksLikeSecretLiteral` quét từng phần tử: `secretArgs` có vị trí (`--token <value>` chỉ bắt được nhờ nhìn phần tử trước).
  - Nhận hai bằng chứng: literal người dùng đang gõ, và sentinel `***` — secret đã lưu về tới dialog dưới dạng `***` qua `masked()`, mà `secretArgs` cố ý bỏ qua sentinel.
  - Chỉ cho `stdio`, giữ đúng tiền đề của backend (`McpServer.warnings` trả `[]` cho transport khác).
  - Mã cảnh báo → khoá i18n `mcp.warnings.*`; không khoá nút Lưu theo cảnh báo — cấu hình đã lưu vẫn phải lưu lại được.
- **Sau Lưu chỉ giữ dialog mở khi có `argsSecretDropped`** — secret đã bị bỏ khỏi cấu hình, xảy ra một lần, và đây là kênh duy nhất báo để người dùng nhập lại. Không hoãn đóng với `argsSecretLiteral`: nó phát lại ở mọi lần Lưu (và đã hiện tại chỗ), hoãn theo nó sinh phản xạ bấm Huỷ cho qua — lần `argsSecretDropped` thật sự xuất hiện thì bị lướt. Lưu vẫn đã thành công (`saved` đã emit), chỉ việc đóng là để người dùng tự bấm.
