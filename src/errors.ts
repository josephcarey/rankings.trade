/**
 * Consistent API error response shape.
 * All API errors return `{ error: { code, message } }`.
 */

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

/**
 * Creates a consistent error response object.
 * @param code - Machine-readable error code (e.g. "NOT_FOUND", "VALIDATION_ERROR")
 * @param message - Human-readable error message
 * @returns Error response object
 */
export function createErrorResponse(code: string, message: string): ApiError {
  return {
    error: {
      code,
      message,
    },
  };
}
