import constant from "@workspace/constant";

type LogLevel = "debug" | "info" | "warn" | "error" | "null";

const LEVEL: Record<LogLevel, number> = { debug: 1, info: 2, warn: 3, error: 4, null: 0 };
const COLOR: Record<LogLevel | "reset", string> = {
  debug: "\x1b[34m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  reset: "\x1b[0m",
  null: "",
};
const label = (name: string, level: LogLevel) => `${COLOR[level]}[${name} ${level}]${COLOR.reset}`;

class Logger {
  name: string = constant.name;
  mode: MODE = "production";
  level: number = 1;

  constructor() {}

  init(name: string, mode: MODE) {
    this.name = `${constant.name} ${name}`;
    this.mode = mode;
    this.level = this.mode !== "production" ? 1 : 2;
  }

  private get caller() {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    const callerLine = lines[3] || "unknown caller";
    const match = callerLine.match(/\(?(\w+:\/\/.*?:\d+:\d+)\)?$/);

    return match?.[1] || callerLine.trim();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private log(level: LogLevel, ...data: any[]) {
    const now = new Date();
    if (this.level > LEVEL[level]) return;

    const caller = this.mode !== "production" ? `\n[caller: ${this.caller}]` : "";
    const prefix = `${label(this.name, level)} [${now.toLocaleString()}] ${caller} \n`;

    if (data.length === 0) {
      console.log(prefix);

      return;
    }

    const [first, ...rest] = data;
    if (typeof first === "string") {
      console.log(`${prefix}${first}`, ...rest);
    } else {
      console.log(prefix, first, ...rest);
    }
  }
  public setLevel(level: LogLevel) {
    this.level = LEVEL[level];
  }
  public getLevel(): LogLevel {
    const reverseLevel = Object.entries(LEVEL).reduce(
      (acc, [key, value]) => {
        acc[value] = key as LogLevel;

        return acc;
      },
      {} as Record<number, LogLevel>,
    );

    return reverseLevel[this.level];
  }
  public get debug() {
    return this.log.bind(this, "debug");
  }
  public get info() {
    return this.log.bind(this, "info");
  }
  public get warn() {
    return this.log.bind(this, "warn");
  }
  public get error() {
    return this.log.bind(this, "error");
  }
  public get null() {
    return this.log.bind(this, "null");
  }
}

const logger = new Logger();
export default logger;
