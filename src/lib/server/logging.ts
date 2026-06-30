import type { RequestEvent } from '@sveltejs/kit';

export function logAccess(event: RequestEvent, action: string, details: Record<string, unknown> = {}): void {
  const ip = getRequestIp(event);
  logEvent(ip, action, details);
}

export function logEvent(ip: string, action: string, details: Record<string, unknown> = {}): void {
  const timestamp = new Date().toISOString();
  const { level = 'INFO', ...rest } = details;
  const serializedDetails = Object.entries(rest)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  console.log(`${timestamp} ${level} ip=${ip || 'unknown'} action=${action}${serializedDetails ? ` ${serializedDetails}` : ''}`);
}

function getRequestIp(event: { request: Request; getClientAddress: () => string }): string {
  try {
    return event.getClientAddress();
  } catch {
    const forwardedFor = event.request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }
    return 'unknown';
  }
}
