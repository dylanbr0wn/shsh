import { useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { hostsAtom } from '../../store/atoms'
import { Tag } from './tag'
import { Input } from './input'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './command'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

export function TagInput({ tags, onChange }: TagInputProps) {
  const hosts = useAtomValue(hostsAtom)
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const commandRef = useRef<HTMLDivElement>(null)

  const allTags = useMemo(() => [...new Set(hosts.flatMap((h) => h.tags ?? []))], [hosts])

  const suggestions = useMemo(
    () =>
      allTags.filter(
        (t) =>
          !tags.includes(t) &&
          (inputValue === '' || t.toLowerCase().includes(inputValue.toLowerCase()))
      ),
    [allTags, tags, inputValue]
  )

  function addTag(t: string) {
    const trimmed = t.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
  }

  function removeTag(t: string) {
    onChange(tags.filter((x) => x !== t))
  }

  function handleSelect(value: string) {
    addTag(value)
    setInputValue('')
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      commandRef.current?.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }))
      return
    }
    if (open && e.key === 'Enter') {
      // Let Command handle selection if dropdown is open
      e.preventDefault()
      commandRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      return
    }
    if (open && e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if ((e.key === 'Enter' || e.key === ',') && inputValue.trim()) {
      e.preventDefault()
      addTag(inputValue.trim().replace(/,$/, ''))
      setInputValue('')
      setOpen(false)
    }
    if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  function handleFocus() {
    if (suggestions.length > 0) setOpen(true)
  }

  function handleBlur() {
    const v = inputValue.trim()
    if (v && !tags.includes(v)) onChange([...tags, v])
    setInputValue('')
    setOpen(false)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value)
    setOpen(suggestions.length > 0 || e.target.value === '')
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Tag key={t} label={t} onRemove={() => removeTag(t)} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            placeholder="Add tag…"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="h-6 w-24 text-xs"
            autoComplete="off"
            autoCorrect="off"
          />
        </PopoverAnchor>
        <PopoverContent
          className="w-40 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          side="bottom"
          align="start"
        >
          <Command ref={commandRef} shouldFilter={false}>
            <CommandList>
              <CommandEmpty className="py-3 text-xs">No existing tags.</CommandEmpty>
              <CommandGroup>
                {suggestions.map((s) => (
                  <CommandItem
                    key={s}
                    value={s}
                    className="text-xs"
                    onSelect={() => handleSelect(s)}
                  >
                    {s}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
