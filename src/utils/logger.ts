type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface LogContext {
  component?: string;
  [key: string]: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const currentLogLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

// Sensitive patterns to redact from logs
const REDACTION_PATTERNS = [
  /access[_-]?token["\s:=]+([a-zA-Z0-9_\-\.]+)/gi,
  /refresh[_-]?token["\s:=]+([a-zA-Z0-9_\-\.]+)/gi,
  /client[_-]?secret["\s:=]+([a-zA-Z0-9_\-\.]+)/gi,
  /authorization:\s*bearer\s+([a-zA-Z0-9_\-\.]+)/gi,
  /code["\s:=]+([a-zA-Z0-9_\-]+)/gi,
  /user[_-]?id["\s:=]+(\d+)/gi,
  /userid["\s:=]+(\d+)/gi,
];

function redactSensitiveData(message: string): string {
  let redacted = message;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, (match, group) => {
      return match.replace(group, "[REDACTED]");
    });
  }
  return redacted;
}

function formatLogMessage(
  level: LogLevel,
  message: string,
  context?: LogContext
): string {
  const timestamp = new Date().toISOString();
  const component = context?.component ? `[${context.component}]` : "";
  const contextStr = context
    ? Object.entries(context)
        .filter(([key]) => key !== "component")
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ")
    : "";

  const logMessage = `${timestamp} ${level.toUpperCase()} ${component} ${message} ${contextStr}`.trim();
  return redactSensitiveData(logMessage);
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

export function createLogger(defaultContext?: LogContext) {
  return {
    trace: (message: string, context?: LogContext) => {
      if (shouldLog("trace")) {
        console.log(
          formatLogMessage("trace", message, { ...defaultContext, ...context })
        );
      }
    },
    debug: (message: string, context?: LogContext) => {
      if (shouldLog("debug")) {
        console.log(
          formatLogMessage("debug", message, { ...defaultContext, ...context })
        );
      }
    },
    info: (message: string, context?: LogContext) => {
      if (shouldLog("info")) {
        console.log(
          formatLogMessage("info", message, { ...defaultContext, ...context })
        );
      }
    },
    warn: (message: string, context?: LogContext) => {
      if (shouldLog("warn")) {
        console.warn(
          formatLogMessage("warn", message, { ...defaultContext, ...context })
        );
      }
    },
    error: (message: string, context?: LogContext) => {
      if (shouldLog("error")) {
        console.error(
          formatLogMessage("error", message, { ...defaultContext, ...context })
        );
      }
    },
  };
}
