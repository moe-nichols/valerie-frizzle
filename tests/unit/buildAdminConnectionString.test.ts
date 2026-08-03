import { describe, expect, test } from 'vitest'
import { buildAdminConnectionString } from '../../src/main/services/adminHttpsProxy'
import { AppError } from '../../src/shared/errors'

describe('buildAdminConnectionString', () => {
  test('replaces the Endpoint with the proxy URL and preserves other params', () => {
    const messagingConnectionString =
      'Endpoint=sb://localhost;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'
    const result = buildAdminConnectionString(messagingConnectionString, 'https://127.0.0.1:54321')
    expect(result).toBe(
      'Endpoint=sb://127.0.0.1:54321;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;'
    )
  })

  test('preserves param order and count regardless of Endpoint position', () => {
    const messagingConnectionString =
      'SharedAccessKeyName=Foo;Endpoint=sb://localhost:1234;SharedAccessKey=Bar;'
    const result = buildAdminConnectionString(messagingConnectionString, 'https://127.0.0.1:9999')
    expect(result).toBe('SharedAccessKeyName=Foo;Endpoint=sb://127.0.0.1:9999;SharedAccessKey=Bar;')
  })

  test('throws when the connection string has no Endpoint to rewrite', () => {
    // Silently returning the input would point the admin client at the emulator (or
    // nowhere) instead of the proxy — fail loudly instead.
    let thrown: unknown
    try {
      buildAdminConnectionString('SharedAccessKeyName=Foo;SharedAccessKey=Bar;', 'https://x:1')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AppError)
    expect((thrown as AppError).code).toBe('VALIDATION_ERROR')
  })
})
