#!/usr/bin/env bash
# Dựng thư viện hệ thống + font cho chromium của Playwright trên máy dev KHÔNG có root.
#
# Chromium cần ~24 shared library mà container dashboard không có, và cũng không có
# font nào — thiếu font thì chrome vẫn chạy nhưng mọi text render ra bề rộng 0px và
# Playwright coi phần tử bounding-box rỗng là "không visible" -> đỏ hàng loạt với lý
# do sai. Đường chuẩn `playwright install-deps` cần root nên không dùng được ở đây:
# ta tải .deb về một prefix trong $HOME rồi giải bằng dpkg-deb.
#
# CI KHÔNG dùng script này — CI chạy `bunx playwright install --with-deps chromium`
# bằng root. playwright.config.ts tự phát hiện prefix nên không cần export gì tay.
#
# Dùng: chạy từ repo root sau `bun install` -> `bun run e2e:sysdeps`
set -euo pipefail

PREFIX="${PW_SYSDEPS_PREFIX:-$HOME/.cache/pw-sysdeps}"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
APTDIR="$PREFIX/.apt"
PW="./node_modules/.bin/playwright"

# 1. Browser — không cần root, tải từ cdn.playwright.dev vào ~/.cache/ms-playwright.
#    Bước này luôn chạy (tự no-op nếu đã có) để tự lành khi cache browser bị dọn.
[ -x "$PW" ] || { echo "FAIL: không thấy $PW — chạy script từ repo root sau khi bun install" >&2; exit 1; }
"$PW" install chromium

CHROME="$("$PW" install --dry-run chromium | awk '/Install location/ {print $3; exit}')/chrome-linux64/chrome"
[ -x "$CHROME" ] || { echo "FAIL: không tìm thấy binary chrome tại $CHROME" >&2; exit 1; }

# 2. Prefix đã dựng xong rồi thì thôi. Kiểm bằng ldd chứ không chỉ kiểm thư mục có
#    tồn tại — một lần dựng dở dang phải được dựng lại, không được bỏ qua.
if [ -d "$LIBDIR" ] && [ "$(LD_LIBRARY_PATH="$LIBDIR" ldd "$CHROME" | grep -c 'not found')" = "0" ]; then
  echo "sysdeps prefix đã sẵn sàng: $PREFIX"
else
  mkdir -p "$APTDIR"/lists/partial "$APTDIR"/cache/archives/partial "$APTDIR"/debs
  touch "$APTDIR/status"
  APTOPT="-o Dir::State::Lists=$APTDIR/lists -o Dir::Cache=$APTDIR/cache -o Dir::State::status=$APTDIR/status"

  apt-get $APTOPT update

  # Lib chromium cần + fontconfig/freetype + 2 gói font Latin.
  SEED="libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2
        libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3
        libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3
        libxkbcommon0 libxrandr2 libfontconfig1 libfreetype6
        fonts-liberation fonts-freefont-ttf"

  # Nở đệ quy rồi LOẠI toolchain đã có sẵn trên hệ thống: prefix chứa libc6 /
  # libstdc++ riêng thì LD_LIBRARY_PATH sẽ ép chrome nạp bản trong prefix cạnh
  # loader của hệ thống -> symbol lookup error. Bộ lọc này là bắt buộc.
  ALL=$(apt-cache $APTOPT depends --recurse --no-recommends --no-suggests \
          --no-conflicts --no-breaks --no-replaces --no-enhances $SEED 2>/dev/null \
        | grep '^[a-z0-9]' | sort -u \
        | grep -vE '^(libc6|libc-bin|libgcc-s1|libstdc\+\+6|gcc-.*-base|libcrypt1|dpkg|debconf|.*:i386)$')

  # apt-get download luôn ghi vào cwd nên phải cd vào thư mục đích.
  ( cd "$APTDIR/debs" && apt-get $APTOPT download $ALL )
  for d in "$APTDIR"/debs/*.deb; do dpkg-deb -x "$d" "$PREFIX"; done
fi

# 3. Kiểm chứng — cả hai phải đạt, nếu không thì fail to tiếng.
MISSING=$(LD_LIBRARY_PATH="$LIBDIR" ldd "$CHROME" | grep -c 'not found' || true)
[ "$MISSING" = "0" ] || {
  echo "FAIL: còn $MISSING lib thiếu:" >&2
  LD_LIBRARY_PATH="$LIBDIR" ldd "$CHROME" | grep 'not found' >&2
  exit 1
}
[ -d "$PREFIX/usr/share/fonts" ] || { echo "FAIL: prefix không có font -> text sẽ render 0px" >&2; exit 1; }

echo "OK — prefix: $PREFIX"
echo "playwright.config.ts tự nhận prefix này; chỉ cần: bun run test:e2e"
