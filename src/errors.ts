/**
 * ============================================================================
 * ERROR HANDLING
 * ============================================================================
 *
 * Standardized error response generation following OpenAI API error format.
 * All error responses conform to the OpenAI error specification to ensure
 * compatibility with OpenAI SDKs and client libraries.
 *
 * @module errors
 * @see {@link https://platform.openai.com/docs/guides/error-codes | OpenAI Error Codes}
 */

/**
 * ============================================================================
 * TYPE DEFINITIONS
 * ============================================================================
 */

/**
 * Standard OpenAI error types.
 *
 * @see {@link https://platform.openai.com/docs/guides/error-codes | OpenAI Error Types}
 */
export type OpenAIErrorType =
  | 'invalid_request_error'      // Invalid request format or parameters
  | 'authentication_error'       // Invalid or missing API key
  | 'permission_denied'          // Insufficient permissions
  | 'not_found_error'            // Resource not found
  | 'rate_limit_error'           // Too many requests
  | 'api_error'                  // Internal server error
  | 'invalid_api_key'            // Specific auth error
  | 'server_error'               // Generic server error
  | 'service_unavailable';       // Service temporarily unavailable

/**
 * OpenAI error response structure.
 */
export interface OpenAIError {
  object: 'error';
  message: string;
  type: OpenAIErrorType;
  param: string | null;
  code: string;
  details?: string;
}

/**
 * ============================================================================
 * ERROR RESPONSE GENERATION
 * ============================================================================
 */

/**
 * Generate a standardized OpenAI-compatible error response.
 *
 * Creates an HTTP Response with error details formatted to match OpenAI's
 * API error structure. This ensures compatibility with OpenAI SDKs and
 * provides consistent error handling across the proxy.
 *
 * @param message - Human-readable error message
 * @param statusCode - HTTP status code (default: 400)
 * @param errorType - OpenAI error type (default: "invalid_request_error")
 * @param errorDetails - Optional additional error details for debugging
 * @param param - Optional parameter name that caused the error
 * @returns Response object with JSON error body and appropriate headers
 *
 * @example
 * // Basic validation error
 * return errorResponse("Missing required field: messages", 400, "invalid_request_error", undefined, "messages");
 *
 * @example
 * // Authentication error
 * return errorResponse("Invalid API key", 401, "authentication_error");
 *
 * @example
 * // Internal server error
 * return errorResponse("Model inference failed", 500, "api_error", error.message);
 *
 * @see {@link OpenAIError} - Error structure specification
 */
export function errorResponse(
  message: string,
  statusCode: number = 400,
  errorType: OpenAIErrorType = "invalid_request_error",
  errorDetails?: string,
  param?: string | null
): Response {
  const errorObject: OpenAIError = {
    object: "error",
    message,
    type: errorType,
    param: param ?? null,
    code: errorType,
    ...(errorDetails && { details: errorDetails })
  };

  // Structured logging with severity level based on status code
  const logLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
  console.error(
    `[${logLevel}] ${statusCode} ${errorType}: ${message}${errorDetails ? ' - ' + errorDetails : ''}${param ? ` (param: ${param})` : ''}`
  );

  return new Response(JSON.stringify({ error: errorObject }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * ============================================================================
 * SPECIALIZED ERROR FACTORIES
 * ============================================================================
 */

/**
 * Create an authentication error response (401).
 *
 * @param message - Error message (default: "Invalid authentication credentials")
 * @returns Response with 401 status and authentication_error type
 *
 * @example
 * return authenticationError("API key is missing or invalid");
 */
export function authenticationError(message: string = "Invalid authentication credentials"): Response {
  return errorResponse(message, 401, "authentication_error");
}

/**
 * Create a validation error response (400).
 *
 * @param message - Error message describing the validation failure
 * @param param - Optional parameter name that failed validation
 * @returns Response with 400 status and invalid_request_error type
 *
 * @example
 * return validationError("messages array cannot be empty", "messages");
 */
export function validationError(message: string, param?: string): Response {
  return errorResponse(message, 400, "invalid_request_error", undefined, param);
}

/**
 * Create a not found error response (404).
 *
 * @param message - Error message (default: "Resource not found")
 * @returns Response with 404 status and not_found_error type
 *
 * @example
 * return notFoundError("Model 'gpt-99' not found");
 */
export function notFoundError(message: string = "Resource not found"): Response {
  return errorResponse(message, 404, "not_found_error");
}

/**
 * Create an internal server error response (500).
 *
 * @param message - Error message (default: "Internal server error")
 * @param details - Optional error details for debugging
 * @returns Response with 500 status and api_error type
 *
 * @example
 * return serverError("Model inference failed", error.message);
 */
export function serverError(message: string = "Internal server error", details?: string): Response {
  return errorResponse(message, 500, "api_error", details);
}

/**
 * Create a rate limit error response (429).
 *
 * @param message - Error message (default: "Rate limit exceeded")
 * @returns Response with 429 status and rate_limit_error type
 *
 * @example
 * return rateLimitError("Too many requests, please slow down");
 */
export function rateLimitError(message: string = "Rate limit exceeded"): Response {
  return errorResponse(message, 429, "rate_limit_error");
}

