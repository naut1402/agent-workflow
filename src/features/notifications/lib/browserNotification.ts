export function sendBrowserNotification(id: string, message: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification(message, { tag: id })
  } catch {
    /* ignore — some environments restrict constructing Notification directly */
  }
}
