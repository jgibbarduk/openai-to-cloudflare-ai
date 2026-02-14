/**
 * ============================================================================
 * ERROR HANDLING
 * ============================================================================
 *
 * Standardized error response generation following OpenAI error format
 */

/**
 * Generate a standardized OpenAI-compatible error response
 * @param message Error message
 * @param statusCode HTTP status code
 * @param errorType OpenAI error type
 * @param errorDetails Optional additional error details
 * @returns Response object with error
 */
export function errorResponse(
  message: string,
  statusCode: number = 400,
  errorType: string = "invalid_request_error",
  errorDetails?: string
): Response {
  const errorObject = {
    object: "error",
    message,
    type: errorType,
    param: null,
    code: errorType,
    ...(errorDetails && { details: errorDetails })
  };

  console.error(`[Error] ${statusCode} ${errorType}: ${message}${errorDetails ? ' - ' + errorDetails : ''}`);

  return new Response(JSON.stringify({ error: errorObject }), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

