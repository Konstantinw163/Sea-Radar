import "server-only";

import {
  AISSTREAM_URL,
  readAisPositionReports as readWithSocket,
  type ReaderError,
  type ReaderOptions as ProtocolReaderOptions,
  type SocketLike,
} from "./aisstream-protocol";

export { AISSTREAM_URL };
export type { ReaderError, SocketLike };

export type ReaderOptions = Omit<ProtocolReaderOptions, "createSocket"> & {
  createSocket?: (url: string) => SocketLike;
};

function createDefaultSocket(url: string): SocketLike {
  return new WebSocket(url);
}

export function readAisPositionReports(options: ReaderOptions) {
  return readWithSocket({
    ...options,
    createSocket: options.createSocket ?? createDefaultSocket,
  });
}
