import { getDefaultStore } from 'jotai'
import {
  isCommandPaletteOpenAtom,
  isQuickConnectOpenAtom,
  isAddHostOpenAtom,
  isImportSSHConfigOpenAtom,
  isSettingsOpenAtom,
} from '../store/atoms'
import { debugPanelOpenAtom } from '../store/debugStore'

const store = getDefaultStore()

export type ActionHandler = (context: ActionContext) => void

export interface ActionContext {
  activeWorkspaceId: string | null
  focusedPaneId: string | null
  splitPane?: (workspaceId: string, paneId: string, direction: 'vertical' | 'horizontal') => void
  setSearchOpen?: (fn: (open: boolean) => boolean) => void
}

const globalActions: Record<string, ActionHandler> = {
  command_palette: () => store.set(isCommandPaletteOpenAtom, (v) => !v),
  quick_connect: () => store.set(isQuickConnectOpenAtom, (v) => !v),
  add_host: () => store.set(isAddHostOpenAtom, (v) => !v),
  import_ssh_config: () => store.set(isImportSSHConfigOpenAtom, (v) => !v),
  settings: () => store.set(isSettingsOpenAtom, (v) => !v),
  debug_panel: () => store.set(debugPanelOpenAtom, (v) => !v),
}

const workspaceActions: Record<string, ActionHandler> = {
  terminal_search: (ctx) => {
    ctx.setSearchOpen?.((open) => !open)
  },
  split_vertical: (ctx) => {
    if (ctx.activeWorkspaceId && ctx.focusedPaneId && ctx.splitPane) {
      ctx.splitPane(ctx.activeWorkspaceId, ctx.focusedPaneId, 'vertical')
    }
  },
  split_horizontal: (ctx) => {
    if (ctx.activeWorkspaceId && ctx.focusedPaneId && ctx.splitPane) {
      ctx.splitPane(ctx.activeWorkspaceId, ctx.focusedPaneId, 'horizontal')
    }
  },
}

export function getActionHandler(actionID: string): ActionHandler | undefined {
  return globalActions[actionID] ?? workspaceActions[actionID]
}
