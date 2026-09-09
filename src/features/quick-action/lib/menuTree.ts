import type { ArtifactMenuNode } from '../../monitor/schemas/artifactAction'

export type MenuGroupOption = { id: string; label: string; depth: number }

export function collectMenuActionIds(menus: ArtifactMenuNode[]): Set<string> {
  const ids = new Set<string>()
  function walk(nodes: ArtifactMenuNode[]) {
    for (const n of nodes) {
      if (n.action_id) ids.add(n.action_id)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(menus)
  return ids
}

/** Keep nodes whose leaves reference allowed action ids; drop empty groups. */
export function pruneMenus(menus: ArtifactMenuNode[], allowedIds: Set<string>): ArtifactMenuNode[] {
  const out: ArtifactMenuNode[] = []
  for (const node of menus) {
    if (node.action_id) {
      if (allowedIds.has(node.action_id)) out.push({ ...node })
      continue
    }
    const children = node.children ? pruneMenus(node.children, allowedIds) : []
    if (children.length) out.push({ ...node, children })
  }
  return out
}

export function splitActionsByMenu<T extends { id: string }>(
  pool: T[],
  menus: ArtifactMenuNode[],
): { flat: T[]; tree: ArtifactMenuNode[] } {
  const inMenu = collectMenuActionIds(menus)
  const flat = pool.filter((a) => !inMenu.has(a.id))
  const tree = pruneMenus(menus, new Set(pool.map((a) => a.id)))
  return { flat, tree }
}

function isGroup(node: ArtifactMenuNode): boolean {
  return !node.action_id
}

function findNode(nodes: ArtifactMenuNode[], id: string): ArtifactMenuNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children?.length) {
      const hit = findNode(n.children, id)
      if (hit) return hit
    }
  }
  return null
}

/** Parent group id that owns the leaf for `actionId`, or null if independent. */
export function findActionMenuId(menus: ArtifactMenuNode[], actionId: string): string | null {
  function walk(nodes: ArtifactMenuNode[], parentId: string | null): string | null {
    for (const n of nodes) {
      if (n.action_id === actionId) return parentId
      if (n.children?.length) {
        const hit = walk(n.children, isGroup(n) ? n.id : parentId)
        if (hit !== null) return hit
      }
    }
    return null
  }
  return walk(menus, null)
}

/** Flat list of group nodes for a select (indented labels via depth). */
export function listMenuGroupOptions(menus: ArtifactMenuNode[]): MenuGroupOption[] {
  const out: MenuGroupOption[] = []
  function walk(nodes: ArtifactMenuNode[], depth: number) {
    for (const n of nodes) {
      if (!isGroup(n)) continue
      out.push({ id: n.id, label: n.label, depth })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(menus, 0)
  return out
}

function removeActionLeaves(nodes: ArtifactMenuNode[], actionId: string): ArtifactMenuNode[] {
  const out: ArtifactMenuNode[] = []
  for (const n of nodes) {
    if (n.action_id === actionId) continue
    if (n.children?.length) {
      out.push({ ...n, children: removeActionLeaves(n.children, actionId) })
    } else {
      out.push({ ...n })
    }
  }
  return out
}

function newLeafId(actionId: string): string {
  return `leaf-${actionId}`
}

/**
 * Attach `actionId` as a leaf under `menuId`, or remove from all menus when
 * `menuId` is null/empty (independent flat toolbar button).
 */
export function setActionMenuMembership(
  menus: ArtifactMenuNode[],
  actionId: string,
  actionLabel: string,
  menuId: string | null,
): ArtifactMenuNode[] {
  const cleaned = removeActionLeaves(menus, actionId)
  if (!menuId) return cleaned

  const parent = findNode(cleaned, menuId)
  if (!parent || !isGroup(parent)) return cleaned

  const leaf: ArtifactMenuNode = {
    id: newLeafId(actionId),
    label: actionLabel,
    action_id: actionId,
  }
  parent.children = [...(parent.children ?? []), leaf]
  return cleaned
}

/** Create a group menu node; optional `parentId` nests under an existing group. */
export function addMenuGroup(
  menus: ArtifactMenuNode[],
  opts: { id: string; label: string; parentId?: string | null },
): ArtifactMenuNode[] {
  const next = structuredClone(menus)
  const node: ArtifactMenuNode = { id: opts.id, label: opts.label, children: [] }
  if (opts.parentId) {
    const parent = findNode(next, opts.parentId)
    if (parent && isGroup(parent)) {
      parent.children = [...(parent.children ?? []), node]
      return next
    }
  }
  next.push(node)
  return next
}
