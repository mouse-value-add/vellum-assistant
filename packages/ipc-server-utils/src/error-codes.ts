/**
 * The `errorCode` an IPC server answers with when it refuses a method before
 * running it because its database is not migrated yet (or failed to
 * migrate). The request had no effect, so a caller may send it again once
 * the server is ready.
 */
export const DB_MIGRATIONS_UNAVAILABLE_ERROR_CODE = "DB_MIGRATIONS_UNAVAILABLE";
