// Short beep via Web Audio API — no binary asset to keep in the repo/bundle.
let sharedCtx: AudioContext | null = null

export function playNotificationSound(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    if (!sharedCtx) sharedCtx = new Ctx()
    const ctx = sharedCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.25)
  } catch {
    /* ignore — unsupported / blocked by autoplay policy */
  }
}
