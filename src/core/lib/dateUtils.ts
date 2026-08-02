/** Thin date helpers for timestamps. */

export function nowMs(): number {
  return Date.now()
}

export function nowIso(d: Date = new Date()): string {
  return d.toISOString()
}

export function nowStamp(d: Date = new Date()): { ts: number; iso: string } {
  return { ts: d.getTime(), iso: d.toISOString() }
}
