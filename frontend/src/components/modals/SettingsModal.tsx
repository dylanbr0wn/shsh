import { useAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { isSettingsOpenAtom, closeConfirmPrefAtom } from '../../store/atoms'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Switch } from '../ui/switch'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '../ui/field'
import { KeybindingsSettings } from '../settings/KeybindingsSettings'
import { SecuritySettings } from '../settings/SecuritySettings'

export function SettingsModal() {
  const [isOpen, setIsOpen] = useAtom(isSettingsOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const { theme, setTheme } = useTheme()

  const checked = closeConfirmPref !== false

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-h-[80vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your preferences</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="keybindings">Keyboard Shortcuts</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-4 pt-2">
            <FieldSet>
              <FieldLegend>Appearance</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel>Theme</FieldLabel>
                  <FieldDescription>
                    Choose light, dark, or follow your system setting.
                  </FieldDescription>
                  <ToggleGroup type="single" value={theme} onValueChange={(v) => v && setTheme(v)}>
                    <ToggleGroupItem value="light">Light</ToggleGroupItem>
                    <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
                    <ToggleGroupItem value="system">System</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
            </FieldSet>
            <FieldSeparator />
            <FieldSet>
              <FieldLegend>Sessions</FieldLegend>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel>
                    Show a confirmation dialog before disconnecting a session.
                  </FieldLabel>
                  <Switch
                    checked={checked}
                    onCheckedChange={(val) => setCloseConfirmPref(val ? null : false)}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>
          </TabsContent>
          <TabsContent value="security" className="space-y-4 pt-2">
            <SecuritySettings />
          </TabsContent>
          <TabsContent value="keybindings" className="pt-2">
            <KeybindingsSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
