import { useEffect, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { fsPanelStateAtom } from '../../store/atoms'
import { useChannelPanelState } from '../../store/useChannelPanelState'
import type { FSEntry, FSState } from '../../types'
import { EventsOn, EventsOff } from '@wailsjs/runtime/runtime'

export type Modal =
  | { type: 'none' }
  | { type: 'mkdir'; value: string }
  | { type: 'rename'; entry: FSEntry; value: string }
  | { type: 'delete'; entry: FSEntry }

export interface FilePanelStateOptions {
  listDirFn: (channelId: string, path: string) => Promise<FSEntry[]>
  getInitialPath: () => Promise<string>
  resolvePath?: (entries: FSEntry[], requestedPath: string) => string
}

export interface FilePanelOperations {
  mkdir: (channelId: string, path: string) => Promise<void>
  rename: (channelId: string, oldPath: string, newPath: string) => Promise<void>
  delete: (channelId: string, path: string) => Promise<void>
}

const DEFAULT_STATE: FSState = {
  currentPath: '',
  entries: [],
  isLoading: false,
  error: null,
}

export function useFilePanelState(
  channelId: string,
  options: FilePanelStateOptions,
  operations: FilePanelOperations
) {
  const [state, setState] = useChannelPanelState(fsPanelStateAtom, channelId, DEFAULT_STATE)
  const { currentPath, entries, isLoading, error } = state
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>({ type: 'none' })
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const listDir = useCallback(
    async (path: string) => {
      setState({ isLoading: true, error: null })
      try {
        const result = await options.listDirFn(channelId, path)
        const resolvedPath = options.resolvePath ? options.resolvePath(result ?? [], path) : path
        setState({ entries: result ?? [], currentPath: resolvedPath, isLoading: false })
      } catch (err) {
        setState({ isLoading: false, error: String(err) })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelId, setState, options.listDirFn, options.resolvePath]
  )

  // Mount init + progress toasts
  useEffect(() => {
    let cancelled = false

    async function init() {
      setState({ isLoading: true, error: null, entries: [], currentPath: '' })
      try {
        const initialPath = await options.getInitialPath()
        if (!cancelled) await listDir(initialPath || '/')
      } catch (err) {
        if (!cancelled) setState({ isLoading: false, error: String(err) })
      }
    }

    init()

    // Transfer progress toasts
    const eventKey = `channel:transfer-progress:${channelId}`
    const toastIds: Map<string, string | number> = new Map()
    const completedPaths: Set<string> = new Set()

    EventsOn(eventKey, (evt: { path: string; bytes: number; total: number }) => {
      if (completedPaths.has(evt.path)) return
      const pct = evt.total > 0 ? Math.round((evt.bytes / evt.total) * 100) : 0
      const label = evt.path.split('/').pop() ?? evt.path
      const existing = toastIds.get(evt.path)
      if (pct >= 100) {
        completedPaths.add(evt.path)
        if (existing !== undefined) {
          toast.success(`${label} transferred`, { id: existing })
        } else {
          toast.success(`${label} transferred`)
        }
        toastIds.delete(evt.path)
      } else if (existing !== undefined) {
        toast.loading(`Transferring ${label}… ${pct}%`, { id: existing })
      } else {
        const id = toast.loading(`Transferring ${label}… ${pct}%`)
        toastIds.set(evt.path, id)
      }
    })

    return () => {
      cancelled = true
      EventsOff(eventKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  function handleRowDoubleClick(entry: FSEntry) {
    if (entry.isDir) {
      listDir(entry.path)
    } else {
      setPreviewPath(entry.path)
    }
  }

  async function handleMkdirConfirm(name: string) {
    setModal({ type: 'none' })
    try {
      await operations.mkdir(channelId, currentPath + '/' + name)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleRenameConfirm(entry: FSEntry, newName: string) {
    setModal({ type: 'none' })
    if (!newName || newName === entry.name) return
    try {
      await operations.rename(channelId, entry.path, currentPath + '/' + newName)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  async function handleDeleteConfirm(entry: FSEntry) {
    setModal({ type: 'none' })
    try {
      await operations.delete(channelId, entry.path)
      await listDir(currentPath)
    } catch (err) {
      toast.error(String(err))
    }
  }

  return {
    currentPath,
    entries,
    isLoading,
    error,
    listDir,
    selected,
    setSelected,
    modal,
    setModal,
    previewPath,
    setPreviewPath,
    handleRowDoubleClick,
    handleMkdirConfirm,
    handleRenameConfirm,
    handleDeleteConfirm,
  }
}
