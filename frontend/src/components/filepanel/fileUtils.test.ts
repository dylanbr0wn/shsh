import { describe, it, expect } from 'vitest'
import { formatSize, formatDate } from './fileUtils'

describe('formatSize', () => {
  it('returns dash for directories', () => {
    expect(formatSize(4096, true)).toBe('—')
  })

  it('formats bytes', () => {
    expect(formatSize(512, false)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatSize(2048, false)).toBe('2.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatSize(1536 * 1024, false)).toBe('1.5 MB')
  })

  it('formats zero bytes', () => {
    expect(formatSize(0, false)).toBe('0 B')
  })
})

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    const result = formatDate('2026-01-15T10:30:00Z')
    // Intl output varies by locale, just verify it doesn't throw and contains year
    expect(result).toContain('2026')
  })

  it('returns the raw string for an invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
