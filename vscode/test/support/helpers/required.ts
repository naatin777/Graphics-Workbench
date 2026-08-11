export function requireValue<T>(value: T | null | undefined, message = 'Expected a value'): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
