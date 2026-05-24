const defaultAllowedPushEndpointHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  ".push.apple.com",
  ".notify.windows.com",
];

export function isAllowedPushEndpoint(value: string, allowedHosts = getAllowedPushEndpointHosts()): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isAllowedPushEndpointHost(url.hostname, allowedHosts);
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

export function isAllowedPushEndpointHost(hostname: string, allowedHosts = getAllowedPushEndpointHosts()): boolean {
  const normalizedHost = hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase();
    if (normalizedAllowedHost.startsWith(".")) {
      const suffix = normalizedAllowedHost.slice(1);
      return normalizedHost.endsWith(normalizedAllowedHost) && normalizedHost !== suffix;
    }
    return normalizedHost === normalizedAllowedHost;
  });
}

function getAllowedPushEndpointHosts(): string[] {
  return (process.env.PUSH_ENDPOINT_ALLOWED_HOSTS ?? defaultAllowedPushEndpointHosts.join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

