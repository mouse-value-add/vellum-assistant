export {
  SocketWatchdog,
  ensureSocketDir,
  type SocketWatchdogOptions,
  type SocketWatchdogLogger,
} from "./socket-watchdog.js";
export {
  isNamedPipePath,
  removeIpcEndpointFile,
  resolveIpcEndpoint,
} from "./endpoint.js";
export { ipcListenOptions } from "./listen-options.js";
export {
  IpcFrameReader,
  writeLegacyMessage,
  writeMessage,
  writeStreamChunk,
  writeStreamEnd,
  type IpcEnvelope,
  type OnMessageCallback,
  type StreamCallbacks,
} from "./ipc-framing.js";
export { DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE } from "./error-codes.js";
