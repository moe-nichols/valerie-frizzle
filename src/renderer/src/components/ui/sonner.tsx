import type * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// This app is fixed to dark mode (see src/renderer/index.html), so the theme is hardcoded
// rather than read from a theme provider like next-themes.
function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
