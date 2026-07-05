# Runbook: dọn artifact `.dev-team-agent/**` khỏi lịch sử git

> **Chỉ con người mới được chạy các bước có đánh dấu ⚠️ dưới đây, sau khi đã tự
> xác nhận riêng.** Không agent nào trong pipeline `dev-team-orchestrator`
> được phép tự động thực thi các bước này — đây là hành động rewrite lịch sử
> + force-push, không thể hoàn tác dễ dàng.

## Bối cảnh

`git ls-files .dev-team-agent` hiện liệt kê các file artifact thật (nội dung
task cụ thể) dù `.gitignore` chỉ định giữ skeleton. Nguyên nhân gốc:
`pushDevTeamArtifacts()` (`server/git/push.ts`) chạy `git add -- .dev-team-agent`
trên toàn thư mục — một khi ≥1 file đã tracked, `git add` (từ Git 2.0) tự động
stage mọi file mới/sửa/xoá trong đường dẫn đó bất kể `.gitignore`.
`scripts/check-devteam-artifacts.ts` (chạy trong CI) chặn tái diễn, nhưng
KHÔNG dọn được lịch sử đã có — cần chạy runbook này một lần để dọn sạch.

## Bước 0 — Cài đặt công cụ (một lần)

```bash
pip install git-filter-repo   # hoặc: brew install git-filter-repo
git filter-repo --version
```

## Bước 1 — Audit branch/PR trước khi rewrite (an toàn, chỉ đọc)

```bash
# 1a. Toàn bộ branch local + remote
git branch -a

# 1b. PR đang mở trên cả 2 remote đã cấu hình
gh pr list --repo naut1402/agent-workflow --state open --json number,title,headRefName,baseRefName,url
gh pr list --repo rakusvn-tttuan/agent-workflow --state open --json number,title,headRefName,baseRefName,url

# 1c. Toàn bộ commit từng chạm .dev-team-agent/** trong mọi lịch sử
git log --all --oneline -- .dev-team-agent > /tmp/devteam-commits.txt
wc -l /tmp/devteam-commits.txt

# 1d. Những remote branch nào chứa các commit đó (sẽ bị ảnh hưởng sau rewrite)
cut -d' ' -f1 /tmp/devteam-commits.txt | while read -r sha; do
  git branch -r --contains "$sha"
done | sort -u
```

Ghi lại output bước 1b + 1d — đây là danh sách PR/branch cần rebase hoặc đóng
trước khi force-push (bước 5).

## Bước 2 — Rewrite trên clone cô lập (KHÔNG đụng working tree đang chạy dashboard)

```bash
cd /tmp   # hoặc bất kỳ đâu KHÁC working tree đang dùng cho dashboard
git clone --no-local /path/to/live/agent-workflow agent-workflow-rewrite
cd agent-workflow-rewrite

git filter-repo --path .dev-team-agent --invert-paths
```

`--invert-paths` xoá toàn bộ thư mục khỏi mọi commit của mọi branch có trong
clone này — kể cả 2 file skeleton (`.gitkeep` × 2, `README.md`), vì
`filter-repo` không phân biệt "chỉ xoá file thật, giữ skeleton" theo path đơn
thuần. Phục hồi skeleton bằng 1 commit mới trên đầu lịch sử đã rewrite:

```bash
mkdir -p .dev-team-agent/.dev-state .dev-team-agent/tasks
touch .dev-team-agent/.dev-state/.gitkeep .dev-team-agent/tasks/.gitkeep
cp /path/to/live/agent-workflow/.dev-team-agent/README.md .dev-team-agent/README.md
git add .dev-team-agent/.dev-state/.gitkeep .dev-team-agent/tasks/.gitkeep .dev-team-agent/README.md
git commit -m "chore: restore .dev-team-agent skeleton after history cleanup"
```

`git filter-repo` tự xoá remote `origin` như một cơ chế an toàn (buộc xác
nhận lại trước khi push) — thêm lại trước bước sau:

```bash
git remote add origin https://github.com/naut1402/agent-workflow.git
```

## Bước 3 — Kiểm tra trước khi push (an toàn, chỉ đọc)

```bash
git log --oneline -- .dev-team-agent          # chỉ còn đúng 1 commit "restore skeleton"
git ls-files .dev-team-agent                  # chỉ liệt kê đúng 3 file skeleton
du -sh .git                                   # xác nhận repo nhỏ lại đáng kể
```

Có thể chạy `bun scripts/check-devteam-artifacts.ts` trong clone này để xác
nhận guard pass.

## ⚠️ Bước 4 — ĐIỂM DỪNG: force-push cần xác nhận tường minh của con người

**Không tự động chạy dưới bất kỳ hình thức nào.** Trình bày lệnh sau cho
người phụ trách xác nhận và tự tay chạy:

```bash
git push --force-with-lease origin main
```

Dùng `--force-with-lease` thay vì `--force` trần — sẽ tự abort nếu
`origin/main` đã bị đẩy thêm commit mới kể từ lần fetch gần nhất (tránh vô
tình đè lên thay đổi mà mình không biết).

## Bước 5 — Xử lý branch/PR bị ảnh hưởng (theo danh sách bước 1)

- Ưu tiên: merge hoặc đóng các PR đang mở trước khi force-push.
- Nếu phải giữ: sau force-push, mỗi contributor tạo lại branch từ
  `origin/main` mới rồi cherry-pick các commit riêng của họ (không đụng
  `.dev-team-agent/**`), thay vì `git rebase --onto` trên lịch sử đã đổi SHA
  hoàn toàn.

## Bước 6 — Thông báo collaborator (mẫu, gửi trước khi force-push)

```
[Thông báo] Lịch sử nhánh `main` của agent-workflow sẽ được viết lại để xoá
artifact nội bộ .dev-team-agent/** đã lỡ commit (không ảnh hưởng code sản phẩm).
Sau khi force-push:
  1. KHÔNG git pull thẳng — sẽ conflict do lịch sử đổi SHA hoàn toàn.
  2. Clone lại từ đầu (khuyến nghị), hoặc: git fetch origin && git reset --hard origin/main
     (chỉ nếu bạn KHÔNG có thay đổi cục bộ chưa push).
  3. Nếu đang có PR/branch mở dựa trên main cũ, tạo lại branch từ main mới rồi
     cherry-pick commit của bạn.
Thời điểm dự kiến: <điền giờ>. Liên hệ <điền người> nếu cần hỗ trợ.
```

## Bước 7 — Collaborator khác (không chạy dashboard trên working tree này) đồng bộ

```bash
git clone https://github.com/naut1402/agent-workflow.git   # cách an toàn nhất
# hoặc, nếu không có thay đổi cục bộ chưa push:
git fetch origin && git checkout main && git reset --hard origin/main
```

## ⚠️ Bước 8 — QUAN TRỌNG: đồng bộ working tree ĐANG chạy dashboard (project `kind: 'local'`)

**KHÔNG** dùng `git reset --hard`/`checkout -f` trên chính working tree này —
nó sẽ xoá vật lý mọi file `.dev-team-agent/**` thật đang cần cho state hiện
tại (chúng có trong lịch sử cũ, biến mất trong lịch sử mới → hard reset đồng
bộ working tree theo cây mới nghĩa là xoá file khỏi đĩa).

```bash
cd /path/to/live/agent-workflow
git fetch origin
git reset --mixed origin/main   # CHỈ --mixed — TUYỆT ĐỐI KHÔNG --hard
git status                      # xác nhận .dev-team-agent/** hiện untracked/ignored, file vẫn còn nguyên trên đĩa
```

`--mixed` (mặc định của `git reset`) di chuyển HEAD + cập nhật index khớp
lịch sử mới nhưng **không đụng working tree** — file thật trên đĩa giữ
nguyên, chỉ đổi trạng thái "tracked" (giờ khớp `.gitignore`, trở thành
untracked/ignored bình thường; dashboard `kind: 'local'` vẫn đọc trực tiếp từ
đĩa nên không bị ảnh hưởng).

## Bước 9 — Ngăn tái diễn

- `scripts/check-devteam-artifacts.ts` + step CI "Guard — no real
  .dev-team-agent artifacts tracked" (`.github/workflows/ci.yml`) — chạy trên
  mọi push/PR, không phụ thuộc transport (bắt được cả trường hợp `kind: 'git'`
  legacy còn `git add` nguyên thư mục).
- `.gitignore` giữ nguyên (đã đúng ý định từ đầu — vấn đề gốc là hành vi
  `git add` trên file đã tracked, không phải rule ignore sai).

## Tham chiếu

Chi tiết đầy đủ (so sánh công cụ, edge cases, lý do chọn `git filter-repo` thay
vì BFG Repo-Cleaner) xem `.dev-team-agent/tasks/B0001/design.md` §3, §4.2
(Phần 2), §4.4.
