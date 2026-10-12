/** Only allow same-site relative redirects (prevents open-redirects via ?next=). */
export function safeNext(next: string | null, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
