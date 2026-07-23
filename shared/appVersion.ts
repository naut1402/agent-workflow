// App semver — nguồn chân lý duy nhất là `package.json` → `version`.
// Đổi version ở đó; Vite (`define`), MCP và UI đều lấy từ module này.
import { version } from '../package.json'

export const APP_VERSION: string = version
