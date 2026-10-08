import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — Tailwind class merge utility (shadcn/ui standard).
 *
 * Combines clsx (conditional classes) with tailwind-merge (deduplicates
 * conflicting Tailwind classes, keeping the last one). This is the
 * canonical shadcn/ui helper used by every UI primitive.
 *
 * Usage:
 *   cn("px-2 py-1", isActive && "bg-primary", className)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
