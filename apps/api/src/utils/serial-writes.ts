export class SerialWrites {
  private chain: Promise<unknown> = Promise.resolve()
  private accepting = true
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Auth-state sudah dihentikan'))
    const result = this.chain.catch(() => undefined).then(operation)
    this.chain = result
    return result
  }
  async stop(): Promise<void> {
    this.accepting = false
    await this.chain
  }
}
