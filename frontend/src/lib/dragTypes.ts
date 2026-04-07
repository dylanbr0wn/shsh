export type PaneDragData = {
  type: 'pane'
  paneId: string
  workspaceId: string
}

export type HostDragData = {
  type: 'host'
  hostId: string
}

export type FileTransferDragData = {
  type: 'file-transfer'
  channelId: string
  path: string
}

export type DragData = PaneDragData | HostDragData | FileTransferDragData

export function isPaneDrag(data: Record<string, unknown>): data is PaneDragData {
  return data.type === 'pane'
}

export function isHostDrag(data: Record<string, unknown>): data is HostDragData {
  return data.type === 'host'
}

export function isFileTransferDrag(data: Record<string, unknown>): data is FileTransferDragData {
  return data.type === 'file-transfer'
}
