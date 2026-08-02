import type { SbAdminApi } from './index'

declare global {
  interface Window {
    sbAdmin: SbAdminApi
  }
}
