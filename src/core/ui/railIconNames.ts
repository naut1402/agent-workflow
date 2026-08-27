/** Tên icon hợp lệ cho `RailIcon.vue` — tách khỏi `.vue` để import type được từ nơi khác
 * (TS không resolve named type export từ `*.vue` qua ambient module `declare module '*.vue'`). */
export type RailIconName =
  | 'panelCollapse'
  | 'panelExpand'
  | 'monitor'
  | 'pipeline'
  | 'catalog'
  | 'rules'
  | 'agent'
  | 'quickAction'
  | 'knowledge'
  | 'runner'
  | 'automations'
  | 'logs'
  | 'statistics'
  | 'settings'
