import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAtom } from 'jotai'
import { toast } from 'sonner'
import { isTerminalProfilesOpenAtom, terminalProfilesAtom } from '../../store/atoms'
import type { TerminalProfile } from '../../types'
import {
  AddTerminalProfile,
  UpdateTerminalProfile,
  DeleteTerminalProfile,
} from '@wailsjs/go/main/HostFacade'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Slider } from '../ui/slider'
import { Field, FieldGroup, FieldLabel } from '../ui/field'
import { Switch } from '../ui/switch'
import { Separator } from '../ui/separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { cn } from '../../lib/utils'
import { COLOR_THEME_OPTIONS } from '../../lib/terminalThemes'
import type { CursorStyle } from '../../types'

const CURSOR_STYLES: CursorStyle[] = ['block', 'underline', 'bar']
const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000]

const DEFAULT_PROFILE_FORM = {
  name: '',
  fontSize: 14,
  cursorStyle: 'block' as CursorStyle,
  cursorBlink: true,
  scrollback: 5000,
  colorTheme: 'auto',
}

type ProfileForm = typeof DEFAULT_PROFILE_FORM

export function TerminalProfilesModal() {
  const [isOpen, setIsOpen] = useAtom(isTerminalProfilesOpenAtom)
  const [profiles, setProfiles] = useAtom(terminalProfilesAtom)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileForm>(DEFAULT_PROFILE_FORM)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  function selectProfile(profile: TerminalProfile) {
    setSelectedId(profile.id)
    setForm({
      name: profile.name,
      fontSize: profile.fontSize,
      cursorStyle: profile.cursorStyle as CursorStyle,
      cursorBlink: profile.cursorBlink,
      scrollback: profile.scrollback,
      colorTheme: profile.colorTheme,
    })
    setIsNew(false)
  }

  function startNew() {
    setSelectedId(null)
    setForm(DEFAULT_PROFILE_FORM)
    setIsNew(true)
  }

  function close() {
    setIsOpen(false)
    setSelectedId(null)
    setIsNew(false)
  }

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Profile name is required')
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        const created = await AddTerminalProfile(form)
        setProfiles((prev) => [...prev, created as unknown as TerminalProfile])
        setSelectedId(created.id)
        setIsNew(false)
        toast.success('Profile created')
      } else if (selectedId) {
        const updated = await UpdateTerminalProfile({ id: selectedId, ...form })
        setProfiles((prev) =>
          prev.map((p) => (p.id === selectedId ? (updated as unknown as TerminalProfile) : p))
        )
        toast.success('Profile saved')
      }
    } catch (err) {
      toast.error('Failed to save profile', { description: String(err) })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedId) return
    try {
      await DeleteTerminalProfile(selectedId)
      setProfiles((prev) => prev.filter((p) => p.id !== selectedId))
      setSelectedId(null)
      setIsNew(false)
      toast.success('Profile deleted')
    } catch (err) {
      toast.error('Failed to delete profile', { description: String(err) })
    }
  }

  const hasChanges =
    isNew ||
    (selected &&
      (form.name !== selected.name ||
        form.fontSize !== selected.fontSize ||
        form.cursorStyle !== selected.cursorStyle ||
        form.cursorBlink !== selected.cursorBlink ||
        form.scrollback !== selected.scrollback ||
        form.colorTheme !== selected.colorTheme))

  const selectedName = profiles.find((p) => p.id === selectedId)?.name ?? 'this profile'

  return (
    <>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{selectedName}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This profile will be removed. Hosts using it will revert to their group or global
              defaults.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Terminal Profiles</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-[420px]">
            {/* Profile list */}
            <div className="flex w-52 shrink-0 flex-col border-r">
              <div className="flex-1 overflow-y-auto py-2">
                {profiles.length === 0 && !isNew && (
                  <p className="text-muted-foreground px-4 py-3 text-xs">No profiles yet</p>
                )}
                {profiles.map((p) => (
                  <Button
                    key={p.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => selectProfile(p)}
                    className={cn(
                      'w-full justify-start rounded-none px-4 text-sm font-normal',
                      selectedId === p.id &&
                        !isNew &&
                        'bg-accent text-accent-foreground font-medium'
                    )}
                  >
                    {p.name}
                  </Button>
                ))}
                {isNew && (
                  <div className="bg-accent text-accent-foreground px-4 py-2 text-sm font-medium">
                    New Profile
                  </div>
                )}
              </div>
              <div className="border-t p-2">
                <Button variant="outline" size="sm" className="w-full text-xs" onClick={startNew}>
                  <Plus data-icon="inline-start" />
                  New Profile
                </Button>
              </div>
            </div>

            {/* Edit pane */}
            {selectedId || isNew ? (
              <div className="flex flex-1 flex-col">
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <FieldGroup>
                    {/* Name */}
                    <Field>
                      <FieldLabel htmlFor="tp-name" className="text-xs">
                        Profile Name
                      </FieldLabel>
                      <Input
                        id="tp-name"
                        placeholder="e.g. Production"
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </Field>

                    <Separator />

                    {/* Color theme */}
                    <Field>
                      <FieldLabel htmlFor="tp-theme" className="text-xs">
                        Color Theme
                      </FieldLabel>
                      <Select
                        value={form.colorTheme}
                        onValueChange={(v) => update('colorTheme', v)}
                      >
                        <SelectTrigger id="tp-theme" className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {COLOR_THEME_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    {/* Font size */}
                    <Field>
                      <div className="flex items-center justify-between">
                        <FieldLabel htmlFor="tp-fontsize" className="text-xs">
                          Font Size
                        </FieldLabel>
                        <span className="text-muted-foreground text-xs">{form.fontSize}px</span>
                      </div>
                      <Slider
                        id="tp-fontsize"
                        min={10}
                        max={24}
                        step={1}
                        value={[form.fontSize]}
                        onValueChange={([v]) => update('fontSize', v)}
                      />
                    </Field>

                    {/* Cursor style */}
                    <Field>
                      <FieldLabel id="tp-cursor-label" className="text-xs">
                        Cursor Style
                      </FieldLabel>
                      <ToggleGroup
                        type="single"
                        value={form.cursorStyle}
                        onValueChange={(v) => v && update('cursorStyle', v as CursorStyle)}
                        className="justify-start"
                        aria-labelledby="tp-cursor-label"
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
                      <FieldLabel className="text-xs" htmlFor="tp-blink">
                        Cursor Blink
                      </FieldLabel>
                      <Switch
                        id="tp-blink"
                        checked={form.cursorBlink}
                        onCheckedChange={(v) => update('cursorBlink', v)}
                      />
                    </Field>

                    <Separator />

                    {/* Scrollback */}
                    <Field>
                      <FieldLabel id="tp-scrollback-label" className="text-xs">
                        Scrollback Lines
                      </FieldLabel>
                      <ToggleGroup
                        type="single"
                        value={String(form.scrollback)}
                        onValueChange={(v) => v && update('scrollback', Number(v))}
                        className="grid grid-cols-2 gap-1"
                        aria-labelledby="tp-scrollback-label"
                      >
                        {SCROLLBACK_OPTIONS.map((n) => (
                          <ToggleGroupItem key={n} value={String(n)} className="h-7 text-xs">
                            {n.toLocaleString()}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                  </FieldGroup>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t px-6 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive gap-1.5 text-xs"
                    onClick={() => setConfirmDelete(true)}
                    disabled={isNew}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={close}>
                      Close
                    </Button>
                    <Button
                      size="sm"
                      className="text-xs"
                      onClick={handleSave}
                      disabled={saving || !hasChanges}
                    >
                      {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-muted-foreground text-sm">
                  Select a profile or create a new one
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
