import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn · concatenate Tailwind classes with conflict resolution.
 *
 * Lets components accept a `className` prop that merges with the
 * component's own classes without "last one wins" surprises (e.g. a
 * caller passing `bg-red-500` overrides the default `bg-white`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
