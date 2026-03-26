import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://dylanbr0wn.github.io',
  base: '/shsh',
  integrations: [
    starlight({
      title: 'shsh',
      description: 'A cross-platform SSH client desktop app',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/dylanbr0wn/shsh',
        },
      ],
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        {
          label: 'Features',
          items: [
            { label: 'Sessions', slug: 'features/sessions' },
            { label: 'SFTP', slug: 'features/sftp' },
            { label: 'Port Forwarding', slug: 'features/port-forwarding' },
            { label: 'SSH Config', slug: 'features/ssh-config' },
            { label: 'Theming', slug: 'features/theming' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Development Setup', slug: 'contributing/development' },
            { label: 'Architecture', slug: 'contributing/architecture' },
          ],
        },
      ],
    }),
  ],
})
