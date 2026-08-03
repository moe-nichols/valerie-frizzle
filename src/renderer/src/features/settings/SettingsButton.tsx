import { useState } from 'react'
import { Settings } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { SettingsDialog } from './SettingsDialog'

export function SettingsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2"
        onClick={() => setOpen(true)}
      >
        <Settings />
        Settings
      </Button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
