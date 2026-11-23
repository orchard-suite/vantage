/**
 * Structured JSON logs on stdout. One line per event: `timestamp`, `level`,
 * `msg` (the event name), the context as fields, and inside a span its
 * `trace_id` and `span_id`, so a line opens its trace. Every task logs its
 * start and its end, every branch leaves a trace. Verbosity is a runtime
 * level, never an omitted statement.
 */
import { isSpanContextValid, trace } from '@opentelemetry/api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds these fields to every line. */
  child(fields: LogFields): Logger;
}

export interface LogSink {
  write(line: string): void;
}

const stdoutSink: LogSink = { write: (line) => process.stdout.write(`${line}\n`) };

export function createLogger(level: LogLevel, sink: LogSink = stdoutSink, base: LogFields = {}): Logger {
  const emit = (lvl: LogLevel, event: string, fields?: LogFields): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    const span = trace.getActiveSpan()?.spanContext();
    const traced = span && isSpanContextValid(span) ? { trace_id: span.traceId, span_id: span.spanId } : {};
    // The envelope is written last so no field can replace it, and first so it leads the line.
    const envelope = { timestamp: new Date().toISOString(), level: lvl, msg: event };
    sink.write(JSON.stringify({ ...envelope, ...base, ...(fields ? serializable(fields) : {}), ...traced, ...envelope }));
  };
  return {
    level,
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (fields) => createLogger(level, sink, { ...base, ...fields }),
  };
}

function serializable(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
}

/** A logger that drops everything; for tests that do not inspect logs. */
export const silentLogger: Logger = createLogger('error', { write: () => undefined });
