export class AsyncQueue<T extends object> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #waiters: ((result: IteratorResult<T>) => void)[] = [];
  #closed = false;

  push(item: T): void {
    if (this.#closed) throw new Error("Cannot push to a closed queue");
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: item });
    else this.#items.push(item);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  get closed(): boolean {
    return this.#closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.#next(),
      return: () => {
        this.close();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  #next(): Promise<IteratorResult<T>> {
    const item = this.#items.shift();
    if (item !== undefined) return Promise.resolve({ done: false, value: item });
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }
}
