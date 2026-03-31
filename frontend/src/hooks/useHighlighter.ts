import { useRef, useCallback, useState } from 'react'
import type { BundledLanguage, Highlighter } from 'shiki'

type Lang = BundledLanguage | 'text'

const EXT_TO_LANG: Record<string, BundledLanguage> = {
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.html': 'html',
  '.css': 'css',
  '.go': 'go',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.md': 'markdown',
  '.toml': 'toml',
  '.sql': 'sql',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.dockerfile': 'dockerfile',
  '.csv': 'csv',
  '.ini': 'ini',
  '.conf': 'ini',
  '.cfg': 'ini',
  '.env': 'shellscript',
  '.makefile': 'makefile',
}

function langFromPath(filePath: string): Lang {
  const name = filePath.split('/').pop() ?? ''
  const lowerName = name.toLowerCase()

  // Handle extensionless files
  if (lowerName === 'dockerfile') return 'dockerfile'
  if (lowerName === 'makefile') return 'makefile'

  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'text'
  const ext = name.slice(dot).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'text'
}

export function useHighlighter() {
  const highlighterRef = useRef<Highlighter | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const highlight = useCallback(async (code: string, filePath: string): Promise<string> => {
    setIsLoading(true)
    try {
      const lang = langFromPath(filePath)

      // For plain text files, return a simple pre-wrapped escape instead of using shiki
      if (lang === 'text') {
        const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return `<pre class="shiki" style="background-color:#24292e;color:#e1e4e8"><code>${escaped}</code></pre>`
      }

      if (!highlighterRef.current) {
        const { createHighlighter } = await import('shiki')
        highlighterRef.current = await createHighlighter({
          themes: ['github-dark'],
          langs: [lang],
        })
      }

      const loadedLangs = highlighterRef.current.getLoadedLanguages()
      if (!loadedLangs.includes(lang)) {
        await highlighterRef.current.loadLanguage(lang)
      }

      return highlighterRef.current.codeToHtml(code, {
        lang,
        theme: 'github-dark',
      })
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { highlight, isLoading }
}
