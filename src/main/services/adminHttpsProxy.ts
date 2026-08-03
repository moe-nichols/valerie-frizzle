import { request as httpRequest } from 'node:http'
import { createServer, type Server } from 'node:https'
import { generate } from 'selfsigned'

// ServiceBusAdministrationClient (the JS/TS @azure/service-bus SDK) hardcodes `https://`
// for every management request, but the emulator's management API only ever serves plain
// HTTP. This proxy terminates TLS locally with a self-signed cert and forwards to the
// emulator's plain-HTTP management port, so the admin client can be pointed at a real
// HTTPS endpoint. The cert is trusted via the SDK's own `tlsOptions.ca` client option —
// no global `NODE_TLS_REJECT_UNAUTHORIZED` override, no SDK patching. Built with only
// `node:https`/`node:http` (no Bun-only APIs) since this runs inside Electron's main
// process, which uses Electron's bundled Node, not Bun.
export interface AdminHttpsProxy {
  url: string
  caCert: string
  close(): Promise<void>
}

export async function startAdminHttpsProxy(targetPort: number): Promise<AdminHttpsProxy> {
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  })

  const server: Server = createServer({ cert: pems.cert, key: pems.private }, (req, res) => {
    const proxyReq = httpRequest(
      {
        host: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: req.headers
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      }
    )
    proxyReq.on('error', (err) => {
      res.writeHead(502)
      res.end(String(err))
    })
    req.pipe(proxyReq)
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        resolve(address.port)
      } else {
        reject(new Error('adminHttpsProxy failed to bind to a port'))
      }
    })
  })

  return {
    url: `https://127.0.0.1:${port}`,
    caCert: pems.cert,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Rebuilds a Service Bus connection string so its Endpoint points at the local admin
 * proxy instead of the emulator directly, preserving every other key/value pair
 * (SharedAccessKeyName, SharedAccessKey, UseDevelopmentEmulator, etc.) from the original.
 */
export function buildAdminConnectionString(
  messagingConnectionString: string,
  adminProxyUrl: string
): string {
  const parts = messagingConnectionString.split(';').filter(Boolean)
  const rebuilt = parts.map((part) =>
    part.startsWith('Endpoint=')
      ? `Endpoint=${adminProxyUrl.replace(/^https:\/\//, 'sb://')}`
      : part
  )
  return `${rebuilt.join(';')};`
}
