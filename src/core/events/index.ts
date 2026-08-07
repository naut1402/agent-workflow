export {
  on,
  once,
  emit,
  registerTrigger,
  unregisterTrigger,
  listTriggers,
  _resetEventBusForTest,
  _resetTriggersForTest,
} from './eventBus.js'
export type {
  DashboardEvent,
  DashboardEventType,
  EventHandler,
  TriggerKind,
  TriggerRegistration,
} from './eventBus.js'
