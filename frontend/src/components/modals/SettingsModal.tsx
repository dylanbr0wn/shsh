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
import { RegistriesSettings } from '../settings/RegistriesSettings'
import { SecuritySettings } from '../settings/SecuritySettings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

export function SettingsModal() {
  const [isOpen, setIsOpen] = useAtom(isSettingsOpenAtom)
  const [closeConfirmPref, setCloseConfirmPref] = useAtom(closeConfirmPrefAtom)
  const { theme, setTheme } = useTheme()

  const checked = closeConfirmPref !== false

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="h-full max-h-[80vh] min-h-0 sm:max-w-2xl">
        <Tabs
          defaultValue="general"
          orientation="vertical"
          className="flex h-full min-h-0 flex-1 gap-3"
        >
          <Card className="w-44">
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription className="text-xs">Configure your shsh</CardDescription>
            </CardHeader>
            <CardContent className="!px-1">
              <TabsList variant="line" className="h-full w-full shrink-0">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
                <TabsTrigger value="keybindings">Shortcuts</TabsTrigger>
                <TabsTrigger value="registries">Registries</TabsTrigger>
              </TabsList>
            </CardContent>
          </Card>
          <TabsContent value="general" className="flex flex-col gap-1 overflow-y-auto">
            <h2 className="text-xl font-bold">General</h2>
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
          <TabsContent value="security" className="h-full space-y-4 overflow-y-auto">
            <SecuritySettings />
          </TabsContent>
          <TabsContent value="keybindings" className="relative h-full">
            <KeybindingsSettings />
          </TabsContent>
          <TabsContent value="registries" className="h-full space-y-4 overflow-y-auto">
            <RegistriesSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
