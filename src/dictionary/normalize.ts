/** Lowercase + collapse whitespace so matching is case/spacing insensitive. */
export function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
