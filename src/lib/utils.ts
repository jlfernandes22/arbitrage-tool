import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
/**
 * Ensures the value is always a real Array. Guards against plain objects
 * with numeric keys (which look like arrays in console but lack .map()).
 *
 * Overloads allow TypeScript to infer the element type T when the input is
 * already typed as T[], while still accepting arbitrary unknown values.
 */
export function ensureArray<T>(value: T[]): T[];
export function ensureArray<T>(value: unknown): T[];
export function ensureArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}