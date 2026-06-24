/**
 * logger.ts — small structured logger for operational diagnostics.
 *
 * The helper intentionally keeps log payloads compact and redacted so HA
 * container logs remain useful without exposing tokens, source URLs, request
 * bodies, payload JSON, filesystem paths, or internal addresses.
 */

import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export type LogFields = Record<string, unknown>;
type LogLevel = "info" | "warn" | "error";

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJECT_DEPTH = 4;
const REDACTED = "[redacted]";

// Key names whose values are redacted wholesale. Covers all three source
// credential slots: `bearer`, the `apiKey` object (so its nested `value` is
// masked), and `basic.password`. Matching the `apiKey` container itself also
// hides the non-secret key name/location, which is acceptable for logging.
const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|authorization|cookie|credential|bearer|apikey|payload|body|headers?|sourceUrl|filePath|path)$/i;
const REQUEST_ID_RE = /^[a-zA-Z0-9._:-]{1,64}$/;

function redactString(value: string, key?: string): string {
  let output = value.replace(/[\r\n\0]+/g, " ");

  if (key !== "route") {
    output = output
      .replace(/\bhttps?:\/\/[^\s"']+/gi, "[redacted-url]")
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-ip]")
      .replace(/\[[0-9a-f:.]+\]/gi, "[redacted-ip]")
      .replace(/(^|[\s"'=:(])\/[A-Za-z0-9._~/-]+/g, "$1[redacted-path]");
  }

  if (output.length > MAX_STRING_LENGTH) {
    return `${output.slice(0, MAX_STRING_LENGTH)}…`;
  }
  return output;
}

function redactValue(value: unknown, key?: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (key && SENSITIVE_KEY_RE.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactString(value, key);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;

  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message, "message"),
      code: typeof (value as NodeJS.ErrnoException).code === "string"
        ? (value as NodeJS.ErrnoException).code
        : undefined,
    };
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_OBJECT_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, key, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[circular]";
    seen.add(value as object);
    if (depth >= MAX_OBJECT_DEPTH) return "[object]";

    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      output[entryKey] = redactValue(entryValue, entryKey, depth + 1, seen);
    }
    return output;
  }

  return String(value);
}

export function redactLogValue(value: unknown): unknown {
  return redactValue(value);
}

function writeLog(level: LogLevel, event: string, fields: LogFields = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactValue(fields) as LogFields),
  };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(event: string, fields?: LogFields): void {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  writeLog("error", event, fields);
}

function normalizeRequestId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return REQUEST_ID_RE.test(trimmed) ? trimmed : null;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = normalizeRequestId(req.get("x-request-id")) ?? randomUUID();
  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function getRequestId(req: Request): string | undefined {
  return req.requestId;
}

export function getResponseRequestId(res: Response): string | undefined {
  const value = res.locals?.requestId;
  return typeof value === "string" ? value : undefined;
}
