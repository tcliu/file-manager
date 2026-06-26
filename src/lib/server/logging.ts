export function logAccess(eventOrRequest: { request?: Request } | Request, action: string, details: Record<string, unknown> = {}): void {
  const ip = getRequestIp(eventOrRequest);
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

function getRequestIp(eventOrRequest: { request?: Request } | Request): string {
  const req: Request | undefined = 'request' in eventOrRequest ? eventOrRequest.request : eventOrRequest as Request;
  const forwardedFor = req?.headers?.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return 'unknown';
}
