import { describe, expect, test } from 'vitest'
import { parseTheme } from '../../src/main/services/themePreference'
import { DEFAULT_THEME } from '../../src/shared/theme'

describe('parseTheme', () => {
  test('falls back to the default when nothing is saved', () => {
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME)
  })

  test('falls back to the default on an unknown value', () => {
    expect(parseTheme('solarized')).toBe(DEFAULT_THEME)
  })

  test('accepts the known themes', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
  })
})
