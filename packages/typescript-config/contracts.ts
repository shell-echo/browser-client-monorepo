export type TsConfig = {
  $schema?: string;
  display?: string;
  extends?: string;
  compilerOptions?: Record<string, unknown>;
};

export const TSCONFIG_SCHEMA_URL = "https://json.schemastore.org/tsconfig";

export const REQUIRED_BASE_OPTIONS = {
  declaration: true,
  declarationMap: true,
  esModuleInterop: true,
  isolatedModules: true,
  module: "NodeNext",
  moduleDetection: "force",
  moduleResolution: "NodeNext",
  noUncheckedIndexedAccess: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: true,
  target: "ES2022",
} as const;

export const REQUIRED_BASE_LIB = ["es2022", "DOM", "DOM.Iterable"] as const;

export function getOptionMismatches(
  actualOptions: Record<string, unknown> | undefined,
  expectedOptions: Record<string, unknown>,
) {
  if (!actualOptions) {
    return Object.keys(expectedOptions);
  }

  return Object.entries(expectedOptions)
    .filter(([key, expectedValue]) => actualOptions[key] !== expectedValue)
    .map(([key]) => key);
}
