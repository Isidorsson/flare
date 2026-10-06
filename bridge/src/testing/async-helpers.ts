export async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the promise to reject");
}

export function chunksOf(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  const remaining = [...chunks];
  return {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<Uint8Array>> => {
        const value = remaining.shift();
        return Promise.resolve(value === undefined ? { done: true, value: undefined } : { done: false, value });
      },
    }),
  };
}
