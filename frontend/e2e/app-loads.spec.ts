import { test, expect } from '@playwright/test'

test('app loads and renders the sidebar', async ({ page }) => {
  await page.goto('/')
  // Wait for the React app to hydrate.
  // The sidebar contains a search input that is always present once hosts are loaded,
  // or a "No saved hosts yet" message in the empty state.
  // The TitleBar's sidebar-toggle button is rendered unconditionally and is the
  // most reliable landmark for confirming the shell has mounted.
  await expect(
    page.getByRole('button', { name: /show sidebar|hide sidebar/i })
  ).toBeVisible({ timeout: 10_000 })
})

test('settings modal opens and closes', async ({ page }) => {
  await page.goto('/')

  // Wait for the app to hydrate before interacting
  await expect(
    page.getByRole('button', { name: /show sidebar|hide sidebar/i })
  ).toBeVisible({ timeout: 10_000 })

  // Open settings via the Settings button in the TitleBar (aria-label="Settings")
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 })

  // Close via Escape
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="dialog"]')).not.toBeVisible()
})
