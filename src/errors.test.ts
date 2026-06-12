import { describe, expect, it } from "vitest";

import { type ApiError, createErrorResponse } from "./errors";

describe("errors", () => {
  it("creates consistent error response shape", () => {
    const error = createErrorResponse("NOT_FOUND", "Resource not found");

    expect(error).toEqual<ApiError>({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    });
  });

  it("supports custom error codes", () => {
    const validationError = createErrorResponse(
      "VALIDATION_ERROR",
      "Invalid email format"
    );
    const authError = createErrorResponse("UNAUTHORIZED", "Invalid credentials");

    expect(validationError.error.code).toBe("VALIDATION_ERROR");
    expect(authError.error.code).toBe("UNAUTHORIZED");
  });

  it("preserves error message exactly", () => {
    const message = "This is a detailed error message with special chars: !@#$%";
    const error = createErrorResponse("CUSTOM_ERROR", message);

    expect(error.error.message).toBe(message);
  });
});
