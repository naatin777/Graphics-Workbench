import { constants, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export type AbortableCopyFile = (
  source: string,
  destination: string,
  flags?: number,
  signal?: AbortSignal,
) => Promise<void>;

/** Copies a file through abort-aware streams so cancellation can stop large staging transfers. */
export const copyFileWithAbort: AbortableCopyFile = async (source, destination, flags = 0, signal) => {
  signal?.throwIfAborted();

  const destinationFlags = (flags & constants.COPYFILE_EXCL) === constants.COPYFILE_EXCL ? 'wx' : 'w';

  await pipeline(
    createReadStream(source, { signal }),
    createWriteStream(destination, { flags: destinationFlags, signal }),
    { signal },
  );

  signal?.throwIfAborted();
};
