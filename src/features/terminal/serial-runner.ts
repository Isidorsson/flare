/**
 * Runs async tasks strictly one after another. PTY writes and resizes go over
 * separate IPC requests, so firing them concurrently could reorder keystrokes.
 * A failing task is reported and the chain carries on with the next one.
 */
export function createSerialRunner(onError: (error: unknown) => void): (task: () => Promise<void>) => void {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    tail = tail.then(task).catch(onError);
  };
}
