import { homeDir, joinPath } from '../../../../../backend/lib/fileHelper.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/**
 * Nguồn có skill cấp máy ở một thư mục phẳng dưới home (`~/<...>/<name>/SKILL.md`).
 * Hiện thực chỉ khai thư mục đó (tương đối từ home) cùng phần quét / `owns` của mình.
 */
export abstract class AbstractHomeSkillSource implements CatalogSource {
  abstract readonly priority: number
  /** Các đoạn path từ home tới thư mục skill, vd `['.claude', 'skills']`. */
  protected abstract readonly skillsHomeSegments: readonly string[]

  abstract owns(source: string): boolean
  abstract scan(ctx: CatalogContext): Promise<ScanResult>

  /** Đọc home mỗi lần gọi — test và runtime đổi `HOME` giữa các lần quét. */
  protected skillsDir(): string {
    return joinPath(homeDir(), ...this.skillsHomeSegments)
  }

  async resolveSkillPath(_ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return joinPath(this.skillsDir(), name, 'SKILL.md')
  }
}
