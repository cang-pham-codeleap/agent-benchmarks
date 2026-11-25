import { SchemaDriftError, SchemaTooNewError, SchemaTooOldError } from "../db.ts";
import { ReadPoolBusyError } from "./read-pool.ts";

export type ApiErrorCode =
  | "ach_missing"
  | "ach_not_installed"
  | "archive_locked"
  | "background_failed"
  | "background_unsupported"
  | "commit_invalid"
  | "combo_exists"
  | "config_unsupported"
  | "cross_origin_read"
  | "cross_origin_write"
  | "eval_active"
  | "eval_not_resumable"
  | "eval_not_running"
  | "eval_survivors"
  | "forbidden_host"
  | "forbidden_remote"
  | "harness_missing"
  | "hidden_command_invalid"
  | "hidden_invalid"
  | "internal_error"
  | "invalid_files_query"
  | "invalid_request"
  | "invalid_session_id"
  | "launch_failed"
  | "launch_unsupported_platform"
  | "malformed_body"
  | "not_found"
  | "query_required"
  | "recommendation_not_found"
  | "repo_invalid"
  | "schema_drift"
  | "schema_too_new"
  | "schema_too_old"
  | "server_busy"
  | "service_starting"
  | "session_not_found"
  | "unknown_dimension"
  | "unknown_status"
  | "unsupported_media_type";

interface ApiError {
  code: ApiErrorCode;
  message: string;
  extras?: Record<string, unknown>;
  status: number;
}

declare const guardedBrand: unique symbol;

/** Only `guarded()` mints this, so every route response carries the security headers. */
export type GuardedResponse = Response & { readonly [guardedBrand]: true };

export function guarded(body: BodyInit | null, init: ResponseInit = {}): GuardedResponse {
  const headers = new Headers(init.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { ...init, headers }) as GuardedResponse;
}

class RequestBodyError extends Error {
  constructor() {
    super("request body must be valid JSON");
    this.name = "RequestBodyError";
  }
}

export function notFoundResponse(): GuardedResponse {
  return errorResponse("not_found", "not found", {}, 404);
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  extras: Record<string, unknown> = {},
  status = 400,
): GuardedResponse {
  return json({ error: message, code, ...extras }, status);
}

export function serviceStartingResponse(): GuardedResponse {
  return errorResponse(
    "service_starting",
    "Agent Benchmarks is still starting. Please try again.",
    { retryable: true },
    503,
  );
}

export function responseForError(error: unknown): GuardedResponse {
  const mapped = classifyError(error);
  return errorResponse(mapped.code, mapped.message, mapped.extras, mapped.status);
}

function classifyError(error: unknown): ApiError {
  if (error instanceof RequestBodyError) {
    return { code: "malformed_body", message: error.message, status: 400 };
  }
  if (error instanceof SchemaDriftError) {
    return { code: "schema_drift", message: error.message, status: 409 };
  }
  if (error instanceof SchemaTooNewError || error instanceof SchemaTooOldError) {
    return { code: error.code, message: error.message, status: 409 };
  }
  if (error instanceof ReadPoolBusyError) {
    return {
      code: "server_busy",
      message: error.message,
      extras: { retryable: true },
      status: 503,
    };
  }
  const normalized = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (isArchiveLockedError(error, normalized)) {
    return {
      code: "archive_locked",
      message: "Session logs are temporarily busy. Please try again.",
      extras: { retryable: true },
      status: 503,
    };
  }
  return {
    code: "internal_error",
    message: "Agent Benchmarks could not complete this request.",
    status: 500,
  };
}

function isArchiveLockedError(error: unknown, normalizedMessage: string): boolean {
  const code =
    typeof error === "object" && error != null && "code" in error
      ? String((error as { code?: unknown }).code).toUpperCase()
      : "";
  return (
    code.startsWith("SQLITE_BUSY") ||
    code.startsWith("SQLITE_LOCKED") ||
    normalizedMessage.includes("database is locked") ||
    normalizedMessage.includes("database table is locked") ||
    normalizedMessage.includes("database is busy")
  );
}

export function json(value: unknown, status = 200): GuardedResponse {
  return guarded(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requireJsonRequest(request: Request): GuardedResponse | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "application/json"
    ? null
    : errorResponse("unsupported_media_type", "content-type must be application/json", {}, 415);
}

export async function readJsonBody(
  request: Request,
  rejectExtras?: Record<string, unknown>,
): Promise<GuardedResponse | { body: Record<string, unknown> }>;
export async function readJsonBody(
  request: Request,
  rejectExtras: null,
): Promise<GuardedResponse | { body: unknown }>;
export async function readJsonBody(
  request: Request,
  rejectExtras: Record<string, unknown> | null = {},
): Promise<GuardedResponse | { body: unknown }> {
  const contentTypeFailure = requireJsonRequest(request);
  if (contentTypeFailure != null) {
    return contentTypeFailure;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestBodyError();
  }
  if (rejectExtras != null && !isJsonObject(body)) {
    return errorResponse(
      "invalid_request",
      "request body must be a JSON object",
      rejectExtras,
      400,
    );
  }
  return { body };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
