import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

// @monaco-editor/react defaults to fetching Monaco from a CDN at runtime, which this
// offline-capable Electron app can't rely on. Point it at the locally bundled
// monaco-editor package instead, and register the language workers Vite needs to bundle
// explicitly via the `?worker` import suffix (Vite's native worker-bundling support,
// no extra plugin needed). Only `editor` (generic, also covers plaintext/XML — XML is a
// tokenizer-only "basic language" with no dedicated worker) and `json` workers are
// registered, since those are the only modes the message composer uses.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') {
      return new jsonWorker()
    }
    return new editorWorker()
  }
}

loader.config({ monaco })
