/**
 * ============================================================================
 * ERRORS MODULE TESTS
 * ============================================================================
 *
 * Behavioral lock-down for all error factory functions.
 */

import {
  errorResponse,
  authenticationError,
  validationError,
  notFoundError,
  serverError,
  rateLimitError,
} from '../src/errors';

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

// ─────────────────────────────────────────────────────────────
// errorResponse — base factory
// ─────────────────────────────────────────────────────────────
describe('errorResponse', () => {
  test('returns a Response with correct status code', async () => {
    const res = errorResponse('Bad input', 400);
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
  });

  test('body has error.object = "error"', async () => {
    const body = await errorResponse('msg', 400).json() as any;
    expect(body.error.object).toBe('error');
  });

  test('body has error.message matching the provided message', async () => {
    const body = await errorResponse('Something went wrong', 500).json() as any;
    expect(body.error.message).toBe('Something went wrong');
  });

  test('body has error.type matching provided errorType', async () => {
    const body = await errorResponse('msg', 400, 'authentication_error').json() as any;
    expect(body.error.type).toBe('authentication_error');
  });

  test('body has error.code matching errorType', async () => {
    const body = await errorResponse('msg', 400, 'rate_limit_error').json() as any;
    expect(body.error.code).toBe('rate_limit_error');
  });

  test('body has error.param when provided', async () => {
    const body = await errorResponse('msg', 400, 'invalid_request_error', undefined, 'messages').json() as any;
    expect(body.error.param).toBe('messages');
  });

  test('body has error.param = null when not provided', async () => {
    const body = await errorResponse('msg', 400).json() as any;
    expect(body.error.param).toBeNull();
  });

  test('body has error.details when provided', async () => {
    const body = await errorResponse('msg', 500, 'api_error', 'stack trace here').json() as any;
    expect(body.error.details).toBe('stack trace here');
  });

  test('body does NOT have error.details when not provided', async () => {
    const body = await errorResponse('msg', 400).json() as any;
    expect(body.error.details).toBeUndefined();
  });

  test('Content-Type header is application/json', () => {
    const res = errorResponse('msg', 400);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  test('defaults statusCode to 400 when omitted', async () => {
    const res = errorResponse('msg');
    expect(res.status).toBe(400);
  });

  test('defaults errorType to invalid_request_error when omitted', async () => {
    const body = await errorResponse('msg').json() as any;
    expect(body.error.type).toBe('invalid_request_error');
  });
});

// ─────────────────────────────────────────────────────────────
// authenticationError
// ─────────────────────────────────────────────────────────────
describe('authenticationError', () => {
  test('returns 401 status', () => {
    expect(authenticationError().status).toBe(401);
  });

  test('error type is authentication_error', async () => {
    const body = await authenticationError().json() as any;
    expect(body.error.type).toBe('authentication_error');
  });

  test('uses default message when none provided', async () => {
    const body = await authenticationError().json() as any;
    expect(body.error.message).toBeTruthy();
  });

  test('uses custom message when provided', async () => {
    const body = await authenticationError('Custom auth error').json() as any;
    expect(body.error.message).toBe('Custom auth error');
  });
});

// ─────────────────────────────────────────────────────────────
// validationError
// ─────────────────────────────────────────────────────────────
describe('validationError', () => {
  test('returns 400 status', () => {
    expect(validationError('bad input').status).toBe(400);
  });

  test('error type is invalid_request_error', async () => {
    const body = await validationError('bad input').json() as any;
    expect(body.error.type).toBe('invalid_request_error');
  });

  test('includes param when provided', async () => {
    const body = await validationError('bad input', 'messages').json() as any;
    expect(body.error.param).toBe('messages');
  });
});

// ─────────────────────────────────────────────────────────────
// notFoundError
// ─────────────────────────────────────────────────────────────
describe('notFoundError', () => {
  test('returns 404 status', () => {
    expect(notFoundError().status).toBe(404);
  });

  test('error type is not_found_error', async () => {
    const body = await notFoundError().json() as any;
    expect(body.error.type).toBe('not_found_error');
  });

  test('uses custom message when provided', async () => {
    const body = await notFoundError('Route does not exist').json() as any;
    expect(body.error.message).toBe('Route does not exist');
  });
});

// ─────────────────────────────────────────────────────────────
// serverError
// ─────────────────────────────────────────────────────────────
describe('serverError', () => {
  test('returns 500 status', () => {
    expect(serverError().status).toBe(500);
  });

  test('error type is api_error', async () => {
    const body = await serverError().json() as any;
    expect(body.error.type).toBe('api_error');
  });

  test('includes details when provided', async () => {
    const body = await serverError('Inference failed', 'CUDA OOM').json() as any;
    expect(body.error.details).toBe('CUDA OOM');
  });
});

// ─────────────────────────────────────────────────────────────
// rateLimitError
// ─────────────────────────────────────────────────────────────
describe('rateLimitError', () => {
  test('returns 429 status', () => {
    expect(rateLimitError().status).toBe(429);
  });

  test('error type is rate_limit_error', async () => {
    const body = await rateLimitError().json() as any;
    expect(body.error.type).toBe('rate_limit_error');
  });

  test('uses custom message when provided', async () => {
    const body = await rateLimitError('Slow down').json() as any;
    expect(body.error.message).toBe('Slow down');
  });
});

