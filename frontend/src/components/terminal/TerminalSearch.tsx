import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { searchAddonsAtom } from '../../store/atoms'

interface Props {
  channelId: string
  onClose: () => void
}

export function TerminalSearch({ channelId, onClose }: Props) {
  const [query, setQuery] = useState('')
  const searchAddons = useAtomValue(searchAddonsAtom)
  const addon = searchAddons[channelId]

  function findNext() {
    if (!query) return
    addon?.findNext(query, {
      incremental: false,
      regex: false,
      caseSensitive: false,
    })
  }

  function findPrev() {
    if (!query) return
    addon?.findPrevious(query, {
      incremental: false,
      regex: false,
      caseSensitive: false,
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        findPrev()
      } else {
        findNext()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  function handleChange(value: string) {
    setQuery(value)
    if (value) {
      addon?.findNext(value, {
        incremental: true,
        regex: false,
        caseSensitive: false,
      })
    }
  }

  return (
    <div className="bg-popover absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border p-1 shadow-md">
      <Input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- search overlay should immediately focus the input
        autoFocus
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in terminal…"
        className="h-7 w-48 text-sm"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={findPrev}
            disabled={!query}
          >
            <ChevronUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous (Shift+Enter)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={findNext}
            disabled={!query}
          >
            <ChevronDown />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next (Enter)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close (Esc)</TooltipContent>
      </Tooltip>
    </div>
  )
}
