/** Hostname được coi là local dashboard (cli-session hợp lệ). */
export function isLocalDashboardHost(hostname?: string): boolean {
  const h = (hostname ?? (typeof window !== 'undefined' ? window.location.hostname : '')).toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}
