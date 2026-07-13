type LogFields = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const logger = console[level] ?? console.log;
  logger(JSON.stringify({ event, ...fields }));
}

export const logger = {
  info(event: string, fields?: LogFields): void {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields): void {
    write("error", event, fields);
  }
};