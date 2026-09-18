export function getHealthStatus(): { status: "ok"; timestamp: string } {
  return { status: "ok", timestamp: new Date().toISOString() };
}
