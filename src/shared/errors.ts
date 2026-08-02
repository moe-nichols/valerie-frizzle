export interface IpcError {
  code: string
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }
