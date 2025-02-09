// src/logger.ts

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

export interface LogOptions {
  level?: LogLevel;        // Now optional
  prefix?: string;
  timestamp?: boolean;
}

export class Logger {
  /**
   * Static property to store a global log level.
   * Defaults to INFO, but you can override it using `setGlobalLevel(...)`.
   */
  private static globalLevel: LogLevel = LogLevel.INFO;

  /**
   * Call this once in your app to set a global logging level
   */
  public static setGlobalLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  private level: LogLevel;
  private prefix: string;
  private timestamp: boolean;

  constructor(options: LogOptions = {}) {
    // If the caller didn't specify `options.level`, use Logger.globalLevel
    this.level = options.level !== undefined ? options.level : Logger.globalLevel;
    this.prefix = options.prefix || '';
    this.timestamp = options.timestamp !== undefined ? options.timestamp : true;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const parts = [];

    if (this.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    parts.push(`[${level}]`);
    parts.push(message);

    if (data !== undefined) {
      if (data instanceof Error) {
        parts.push(`\n${data.stack || data.message}`);
      } else if (typeof data === 'object') {
        parts.push('\n' + JSON.stringify(data, null, 2));
      } else {
        parts.push(String(data));
      }
    }

    return parts.join(' ');
  }

  error(message: string, data?: any): void {
    if (this.level >= LogLevel.ERROR) {
      process.stderr.write(this.formatMessage('ERROR', message, data) + '\n');
    }
  }

  warn(message: string, data?: any): void {
    if (this.level >= LogLevel.WARN) {
      process.stdout.write(this.formatMessage('WARN', message, data) + '\n');
    }
  }

  info(message: string, data?: any): void {
    if (this.level >= LogLevel.INFO) {
      process.stdout.write(this.formatMessage('INFO', message, data) + '\n');
    }
  }

  debug(message: string, data?: any): void {
    if (this.level >= LogLevel.DEBUG) {
      process.stdout.write(this.formatMessage('DEBUG', message, data) + '\n');
    }
  }

  trace(message: string, data?: any): void {
    if (this.level >= LogLevel.TRACE) {
      process.stdout.write(this.formatMessage('TRACE', message, data) + '\n');
    }
  }
}
