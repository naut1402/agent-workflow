# Corporate CA (build-time staging)

`install.sh` copies host CA files here when these env vars are set:

- `NODE_EXTRA_CA_CERTS`
- `SSL_CERT_FILE`
- `REQUESTS_CA_BUNDLE`
- `CURL_CA_BUNDLE`

It also writes `manifest.env` with **basenames only** (e.g. `NODE_EXTRA_CA_CERTS=Fortinet.cer`).
The Dockerfile COPYs this directory into `/etc/ssl/corp-ca/` and `install-corp-ca.sh`
resolves basenames there.

Do **not** pass absolute `/etc/...` paths as Docker build-args from Git Bash/MSYS —
those get rewritten to `C:/Program Files/Git/etc/...` and break the Linux build.

Do not commit real certificates — this directory is gitignored except `.gitkeep` / this README.
