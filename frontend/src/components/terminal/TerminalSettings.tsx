import { useAtom } from 'jotai'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { terminalSettingsAtom, DEFAULT_TERMINAL_SETTINGS } from '@/atoms/terminalSettings'
import type { CursorStyle } from '@/atoms/terminalSettings'
import { cn } from '@/lib/utils'

const CURSOR_STYLES: CursorStyle[] = ['block', 'underline', 'bar']
const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000]

export function TerminalSettings() {
  const [settings, setSettings] = useAtom(terminalSettingsAtom)

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function reset() {
    setSettings(DEFAULT_TERMINAL_SETTINGS)
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground size-6">
              <Settings />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Terminal settings</TooltipContent>
      </Tooltip>

      <PopoverContent side="left" align="start" className="w-64 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Terminal Settings</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={reset}>
              Reset
            </Button>
          </div>

          <Separator />

          {/* Font size */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Font Size</Label>
              <span className="text-muted-foreground text-xs">{settings.fontSize}px</span>
            </div>
            <Slider
              min={10}
              max={24}
              step={1}
              value={[settings.fontSize]}
              onValueChange={([v]) => update('fontSize', v)}
            />
          </div>

          {/* Cursor style */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Cursor Style</Label>
            <div className="flex gap-1">
              {CURSOR_STYLES.map((style) => (
                <Button
                  key={style}
                  variant={settings.cursorStyle === style ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 flex-1 text-xs capitalize"
                  onClick={() => update('cursorStyle', style)}
                >
                  {style}
                </Button>
              ))}
            </div>
          </div>

          {/* Cursor blink */}
          <div className="flex items-center justify-between">
            <Label className="text-xs" htmlFor="cursor-blink">
              Cursor Blink
            </Label>
            <Switch
              id="cursor-blink"
              checked={settings.cursorBlink}
              onCheckedChange={(v) => update('cursorBlink', v)}
            />
          </div>

          <Separator />

          {/* Scrollback */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Scrollback Lines</Label>
            <div className="grid grid-cols-2 gap-1">
              {SCROLLBACK_OPTIONS.map((n) => (
                <Button
                  key={n}
                  variant={settings.scrollback === n ? 'default' : 'outline'}
                  size="sm"
                  className={cn('h-7 text-xs', settings.scrollback === n && 'font-medium')}
                  onClick={() => update('scrollback', n)}
                >
                  {n.toLocaleString()}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
