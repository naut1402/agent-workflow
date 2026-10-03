# Tool usage của agent — 2026-10

**Task:** `Tbefa5f4c` · **Nguồn số liệu:** snapshot `~/.claude/projects/**/*.jsonl` + `agent-sdk-sessions/` đo ở bước điều tra (2026-10-01)

> [!IMPORTANT]
> Mọi con số trong §1–§3 là **snapshot một lần** phân tích tĩnh từ transcript còn sót lại. Task dùng snapshot này để chọn tool, không giữ lại đường đo liên tục.

---

## §1. Độ phủ dữ liệu

| Chỉ số | Giá trị |
|---|---|
| Job đã chạy | 1.437 |
| Job có `sessionId` | 1.424 |
| Job còn truy được transcript | **41/1.437 (2,9%)** |
| Transcript còn trên đĩa | 35 file · 25 phiên có tool call |
| Lượt gọi tool đếm được | **499** |

Theo tháng: 2026-08 có 626 job → **0** transcript; 2026-09 có 797 → 37; 2026-10 có 13 → 4. Ba hàng cộng thành **1.436 job**, thiếu 1 so với tổng 1.437 đã ghi; chưa có snapshot gốc để xác định tháng của job chênh lệch. Tỷ lệ theo job trong báo cáo dùng chung mẫu số **1.437** (tổng đã ghi), không dùng tổng các hàng tháng hay 1.424 job có session.

🚫 **Báo cáo này không lặp lại được bằng cách đọc lại transcript.** Transcript bị prune; job tháng 8 không còn gì để đọc.

---

## §2. Tần suất

### 2.1 Theo tool

| Tool | Lượt | Tỷ lệ |
|---|---|---|
| `Bash` | 455 | 91,2% |
| `WebSearch` | 20 | 4,0% |
| `WebFetch` | 11 | 2,2% |
| `Write` | 9 | 1,8% |
| `Edit` | 2 | 0,4% |
| `ToolSearch` | 1 | 0,2% |
| `Read` | 1 | 0,2% |
| `mcp__*` | **0** | **0%** |

**10 MCP tool đã đăng ký, 0 lượt gọi.** Smoke test xác nhận server chạy và trả dữ liệu thật, nên đây là vấn đề *adoption*, không phải *thiếu tool*. 267 job có đính `--mcp-config` mà vẫn 0 lượt.

⚠️ 1.305/1.437 job chạy `--dangerously-skip-permissions`, và ở chế độ đó harness chủ động dặn agent ưu tiên Bash. **91,2% là triệu chứng, không phải nguyên nhân** — đừng dùng con số này một mình để biện minh cho một tool thay 1-1 cho `cat`/`grep`.

> Mẫu số 1.435 ở bản cũ không có nguồn xác nhận phạm vi riêng; đã thống nhất về tổng 1.437 của §1. Đây là hiệu chỉnh cách trình bày snapshot, chưa phải kết quả đo lại.

### 2.2 Bash làm gì

455 lượt → 2.437 đoạn lệnh, trung bình **5,36 đoạn/lượt**, **93,4%** là lệnh ghép.

| Ý định | Lượt Bash | Tỷ lệ |
|---|---|---|
| đọc file (`cat`/`head`/`tail`/`sed -n`) | 374 | 82,2% |
| tìm trong code (`grep`/`rg`) | 179 | 39,3% |
| liệt kê thư mục (`ls`) | 112 | 24,6% |
| `find` | 41 | 9,0% |
| `curl` | 24 | 5,3% |
| script nhúng heredoc | 13 | 2,9% |
| `git` | 10 | 2,2% |

Một lượt mang nhiều ý định nên tổng vượt 100% — đó là hành vi đúng của chỉ số, không phải lỗi làm tròn.

**`cd` lặp vô ích chiếm 74,1% lượt Bash**: 337/455 lượt có `cd` tuyệt đối, riêng `cd /data/project/agent-workflow` xuất hiện 275 lần. Nguyên nhân là cwd reset sau mỗi lượt Bash cộng quy ước cwd-là-thư-mục-task. Mọi tool nhận `taskId` xoá hẳn khoản này.

---

## §3. Pattern nổi bật

### 3.1 Vòng lặp khảo sát — 69,1% cặp lệnh

430 cặp lệnh liên tiếp trong cùng phiên:

| Cặp | Lượt | Tỷ lệ |
|---|---|---|
| `grep → grep` | 81 | 18,8% |
| `read → read` | 77 | 17,9% |
| `read → grep` | 76 | 17,7% |
| `grep → read` | 63 | 14,7% |
| `find → read` | 15 | 3,5% |
| `read → find` | 11 | 2,6% |

`read`/`grep` đan nhau = **297/430 = 69,1%** toàn bộ cặp. Đây là pattern đắt nhất đo được.

### 3.2 Chi phí lượt tập trung ở phiên dài

25 phiên · trung vị **4** lượt Bash/phiên · cao nhất **63**. **10 phiên nặng nhất chiếm 88%** tổng số lượt Bash.

→ Tối ưu phải nhắm vào phiên khảo sát dài. Một tool tiết kiệm 1 lượt cho mọi phiên gần như không đổi gì; một tool cắt được vòng lặp khảo sát mới đáng.

### 3.3 Bootstrap đầu phiên — 21/25 phiên giống hệt nhau

**21/25 phiên** mở đầu bằng đúng một việc: `pwd`/`ls -la` rồi `cat request.md`. Biến thể chỉ khác ở dấu phân cách `echo`.

| File đọc lặp | Lượt | Số phiên |
|---|---|---|
| `request.md` | 21 | 21 |
| `pipeline.yaml` | 15 | 15 |
| `AGENTS.md` | 6 | 6 |
| `.dev-team-agent/project-rules.md` | 6 | 6 |
| `investigate.md` | 6 | 5 |

### 3.4 Gọi API dashboard bằng `curl` thủ công

24 lượt trên 14 phiên: `POST /api/orchestrator/decide` 13 · `GET /api/orchestrator/status` 10 · `GET /api/orchestrator/output` 1.

Nguyên nhân gốc nằm trong prompt: chuỗi `curl` mẫu được viết sẵn ở `src/features/orchestrator/business/decision.ts`.

### 3.5 Agent tự kiểm tài liệu của chính mình

61/455 lượt Bash (13,4%) đụng artifact của chính task; trong đó **13 lượt** grep heading markdown kèm máy trạng thái `awk` tự chế để kiểm rule doc-writing. Cùng một logic bị viết lại bằng tay ở nhiều phiên.

### 3.6 Nhánh runner API (bộ tool khác)

`agent-sdk-sessions/`: 120 file, 25 file có tool call — `search_files` 32 · `list_directory` 29 · `read_file` 17 · `write_file` 4. Cùng hình dạng với nhánh CLI: tìm > liệt kê > đọc.

> [!NOTE]
> Đây là số **thô trên file**, tách khỏi mẫu CLI 499 lượt / 455 Bash ở §1–§3.5. Lần ingest cũ ghi `search_files` 16 · `list_directory` 16 · `read_file` 10 · `write_file` 4: chỉ 13/25 file session nối được về job record, và bộ đọc còn khử trùng `(name, text)`, làm mất cả lượt gọi lặp hợp lệ. Các số ingest cũ không dùng làm số đã hiệu chỉnh.

---

## §4. Đề xuất MCP tool

| # | Tool | Ưu tiên | Căn cứ số liệu | Trạng thái |
|---|---|---|---|---|
| 1 | `get_task_context` | **P0** | 21/25 phiên mở đầu bằng đúng chuỗi `cd` + `cat request.md` + `cat pipeline.yaml` + `ls -la` (§3.3). Gộp 4 nguồn → tiết kiệm 3–5 lượt mở màn ở hầu hết job, và nhận `taskId` nên xoá luôn phần `cd` (§2.2) | ✅ **Đã giao** trong task này |
| 2 | `search_code` | **P0** | 69,1% cặp lệnh là vòng lặp `read`/`grep` (§3.1), tập trung ở 10 phiên nặng chiếm 88% lượt Bash (§3.2). Gộp grep + read cắt đúng pattern đắt nhất | ⏸️ Hoãn — cần máy quét file hoàn chỉnh (ignore rule, nhị phân, trần kết quả, hiệu năng), repo chưa có helper nào gần. |
| 3 | `orchestrator_decide` / `orchestrator_status` | P1 | 24 lượt `curl` / 14 phiên (§3.4). Bỏ được cả header auth lẫn biến môi trường `DASHBOARD_ORCHESTRATOR_*` agent đang phải tự kiểm | 🔁 **Không làm tool — sửa prompt.** `buildDecisionPrompt` tiêm sẵn trạng thái (cổng chờ duyệt, step đang chạy) và bỏ khối `curl` mẫu; agent ra lệnh bằng dòng `ORCHESTRATOR_DECISION` |
| 4 | `validate_artifact` | P1 | 13 lượt `awk`/`grep` tự chế kiểm rule doc-writing (§3.5) | ⏸️ Hoãn — phải nhúng toàn bộ rule doc-writing thành luật máy chạy được; đó là một thiết kế riêng |
| 5 | `get_tool_stats` | P2 | Nhu cầu của người vận hành, không phải của agent trong phiên | ❌ Bỏ — task không giữ đường đo liên tục |

### 4.1 Vì sao chỉ giao một tool

Thêm tool thứ hai trước khi biết tool thứ nhất có được gọi hay không là lặp lại đúng tình huống hiện tại: 10 tool, 0 lượt. Thay đổi kèm theo trong task này nhắm thẳng vào adoption:

- **Mô tả tool nói rõ nó thay cái gì** — `get_task_context` ghi thẳng chuỗi `cd … && cat request.md && cat pipeline.yaml && ls -la` trong `description`.
- **Hướng dẫn dùng tool đi kèm server** — MCP server trả `instructions` theo mode (`docs/mcp/server.md` §3.1) thay cho khối chép tay trong từng template agent.
