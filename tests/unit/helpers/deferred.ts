export interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value?: T) => void
  reject: (err: unknown) => void
}

/** A promise whose settlement the test controls. */
export function defer<T = void>(): Deferred<T> {
  let resolve!: (value?: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res as (value?: T) => void
    reject = rej
  })
  return { promise, resolve, reject }
}
