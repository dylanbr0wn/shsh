import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { SlidersHorizontal } from 'lucide-react'
import {
  isTerminalProfilesOpenAtom,
  activeSessionIdAtom,
  sessionsAtom,
  hostsAtom,
  groupsAtom,
  terminalProfilesAtom,
  sessionProfileOverridesAtom,
} from '@/store/atoms'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { terminalSettingsAtom, DEFAULT_TERMINAL_SETTINGS } from '@/atoms/terminalSettings'
import type { CursorStyle } from '@/atoms/terminalSettings'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '../ui/field'

const CURSOR_STYLES: CursorStyle[] = ['block', 'underline', 'bar']
const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000]

export function TerminalSettings() {
  const [settings, setSettings] = useAtom(terminalSettingsAtom)
  const setProfilesOpen = useSetAtom(isTerminalProfilesOpenAtom)

  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessions = useAtomValue(sessionsAtom)
  const hosts = useAtomValue(hostsAtom)
  const groups = useAtomValue(groupsAtom)
  const profiles = useAtomValue(terminalProfilesAtom)
  const [sessionOverrides, setSessionOverrides] = useAtom(sessionProfileOverridesAtom)

  // Resolve what profile is active for this session (without override)
  const session = sessions.find((s) => s.id === activeSessionId)
  const host = hosts.find((h) => h.id === session?.hostId)
  const group = groups.find((g) => g.id === host?.groupId)
  const hostProfileId = host?.terminalProfileId ?? group?.terminalProfileId
  const hostProfile = profiles.find((p) => p.id === hostProfileId)

  const overrideId = activeSessionId ? sessionOverrides[activeSessionId] : undefined
  const selectValue = overrideId ?? '__auto__'

  function setProfileOverride(val: string) {
    if (!activeSessionId) return
    if (val === '__auto__') {
      setSessionOverrides((prev) => {
        const next = { ...prev }
        delete next[activeSessionId]
        return next
      })
    } else {
      setSessionOverrides((prev) => ({ ...prev, [activeSessionId]: val }))
    }
  }

  function update<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function reset() {
    setSettings(DEFAULT_TERMINAL_SETTINGS)
  }

  const autoLabel = hostProfile ? `Default (${hostProfile.name})` : 'Default'

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              aria-label="Terminal settings"
            >
              <SlidersHorizontal aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="left">Terminal settings</TooltipContent>
      </Tooltip>

      <PopoverContent side="left" align="start" className="w-64 p-4">
        <div className="flex flex-col gap-4">
          <FieldSet>
            <FieldLegend className='flex justify-between items-center'>
              <span>Terminal settings</span>
              <Button variant="outline" size="sm" onClick={reset}>
                Reset
              </Button>
            </FieldLegend>
            <FieldDescription>Customize your terminal</FieldDescription>
            <FieldSeparator />
            <FieldGroup>
              {activeSessionId && (
                <Field>
                  <FieldLabel htmlFor="ts-profile">Profile</FieldLabel>
                  <Select value={selectValue} onValueChange={setProfileOverride}>
                    <SelectTrigger id="ts-profile" className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__auto__" className="text-xs">
                          {autoLabel}
                        </SelectItem>
                      </SelectGroup>
                      {profiles.length > 0 && (
                        <>
                          <SelectSeparator />
                          <SelectGroup>
                            {profiles.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <FieldSeparator />

              {/* Font size */}
              <Field className="flex flex-col gap-2">
                <FieldLabel htmlFor="ts-fontsize" className="flex items-center justify-between">
                  <div>Font Size</div>
                  <span className="text-muted-foreground text-xs">{settings.fontSize}px</span>
                </FieldLabel>
                <Slider
                  id="ts-fontsize"
                  min={10}
                  max={24}
                  step={1}
                  value={[settings.fontSize]}
                  onValueChange={([v]) => update('fontSize', v)}
                />
              </Field>

              {/* Cursor style */}
              <Field>
                <FieldLabel id="ts-cursor-label">Cursor Style</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={settings.cursorStyle}
                  onValueChange={(v) => v && update('cursorStyle', v as CursorStyle)}
                  className="justify-start"
                  aria-labelledby="ts-cursor-label"
                >
                  {CURSOR_STYLES.map((style) => (
                    <ToggleGroupItem
                      key={style}
                      value={style}
                      className="h-7 flex-1 text-xs capitalize"
                    >
                      {style}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              {/* Cursor blink */}
              <Field orientation="horizontal">
                <FieldLabel htmlFor="cursor-blink">Cursor Blink</FieldLabel>
                <Switch
                  id="cursor-blink"
                  checked={settings.cursorBlink}
                  onCheckedChange={(v) => update('cursorBlink', v)}
                />
              </Field>

              <FieldSeparator />

              {/* Scrollback */}
              <Field>
                <FieldLabel id="ts-scrollback-label">
                  Scrollback Lines
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  value={String(settings.scrollback)}
                  onValueChange={(v) => v && update('scrollback', Number(v))}
                  className="grid grid-cols-2 gap-1"
                  aria-labelledby="ts-scrollback-label"
                >
                  {SCROLLBACK_OPTIONS.map((n) => (
                    <ToggleGroupItem key={n} value={String(n)} className="h-7 text-xs">
                      {n.toLocaleString()}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <FieldSeparator />

              <Button
                variant="outline"
                size="sm"
                className="h-7 w-full justify-start px-2 text-xs"
                onClick={() => setProfilesOpen(true)}
              >
                Manage Profiles…
              </Button>
            </FieldGroup>
          </FieldSet>
          {/* Profile override */}
        </div>
      </PopoverContent>
    </Popover>
  )
}
