# Corporate CA (build-time staging)

`install.sh` copies host CA files here when these env vars are set:

- `NODE_EXTRA_CA_CERTS`
- `SSL_CERT_FILE`
- `REQUESTS_CA_BUNDLE`
- `CURL_CA_BUNDLE`

Staged files are baked into the image at `/etc/ssl/corp-ca/` and wired to matching
container env vars. Do not commit real certificates — this directory is gitignored
except `.gitkeep` / this README.
