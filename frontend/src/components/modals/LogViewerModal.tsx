import { useAtom } from 'jotai'
import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Trash2, FolderOpen, Copy, FileText, X, Eye } from 'lucide-react'
import { isLogViewerOpenAtom } from '../../store/atoms'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Badge } from '../ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import {
  ListSessionLogs,
  ReadSessionLog,
  DeleteSessionLog,
  OpenLogsDirectory,
} from '../../../wailsjs/go/main/App'
import { toast } from 'sonner'
import type { LogFileInfo } from '../../types'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '../ui/item'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function LogViewerModal() {
  const [isOpen, setIsOpen] = useAtom(isLogViewerOpenAtom)
  const [logs, setLogs] = useState<LogFileInfo[]>([])
  const [viewingLog, setViewingLog] = useState<{ info: LogFileInfo; content: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadLogs = useCallback(async () => {
    try {
      const result = await ListSessionLogs()
      setLogs(result)
    } catch {
      setLogs([])
    }
  }, [])

  useEffect(() => {
    if (isOpen && !viewingLog) {
      loadLogs()
    }
  }, [isOpen, viewingLog, loadLogs])

  function handleClose(open: boolean) {
    setIsOpen(open)
    if (!open) setViewingLog(null)
  }

  async function openLog(info: LogFileInfo) {
    setIsLoading(true)
    try {
      const content = await ReadSessionLog(info.path)
      setViewingLog({ info, content })
    } catch (e: unknown) {
      toast.error('Failed to read log', { description: String(e) })
    } finally {
      setIsLoading(false)
    }
  }

  async function deleteLog(info: LogFileInfo) {
    try {
      await DeleteSessionLog(info.path)
      setLogs((prev) => prev.filter((l) => l.path !== info.path))
      toast.success('Log deleted')
    } catch (e: unknown) {
      toast.error('Failed to delete log', { description: String(e) })
    }
  }

  function copyContent() {
    if (!viewingLog) return
    navigator.clipboard.writeText(viewingLog.content)
    toast.success('Copied to clipboard')
  }

  function copyFileName() {
    if (!viewingLog) return
    navigator.clipboard.writeText(viewingLog.info.filename)
    toast.success('Filename copied to clipboard')
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-3">
            {viewingLog && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setViewingLog(null)}
              >
                <ArrowLeft data-icon />
              </Button>
            )}
            <DialogTitle className="truncate">
              {viewingLog ? viewingLog.info.filename : 'Session Logs'}
            </DialogTitle>

            {!viewingLog && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => OpenLogsDirectory()}
              >
                <FolderOpen data-icon />
              </Button>
            )}
            {viewingLog && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={copyFileName}>
                    <Copy data-icon />
                  </Button>
                </TooltipTrigger>

                <TooltipContent side="right">Copy filename</TooltipContent>
              </Tooltip>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleClose(false)}
              >
                <X data-icon />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {!viewingLog ? (
          <ScrollArea className="min-h-0 flex-1">
            {logs.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>No session logs yet.</EmptyTitle>
                  <EmptyDescription>
                    Start a session and click the record button to capture output.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup>
                {logs.map((log) => (
                  <>
                    <Item key={log.path} variant="outline" className="hover:bg-accent/50">
                      <ItemContent className="min-w-0 flex-1">
                        <ItemTitle className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{log.hostLabel}</span>
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {formatBytes(log.sizeBytes)}
                          </Badge>
                        </ItemTitle>
                        <ItemDescription className="text-muted-foreground mt-0.5 truncate text-xs">
                          {formatDate(log.createdAt)}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="flex shrink-0 items-center gap-1">
                        <Button disabled={isLoading} variant="outline" className="shrink-0" onClick={() => openLog(log)}>
                          <Eye data-icon />
                          <span>Open</span>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                              }}
                            >
                              <Trash2 data-icon />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete log?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete{' '}
                                <span className="font-medium">{log.filename}</span>.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteLog(log)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </ItemActions>
                    </Item>
                  </>
                ))}
              </ItemGroup>
            )}
          </ScrollArea>
        ) : (
          <ScrollArea className="relative h-[60vh] grow">
            <pre className="p-6 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 size-6"
                    onClick={copyContent}
                  >
                    <Copy data-icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Copy log content</TooltipContent>
              </Tooltip>
              {viewingLog.content}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
