// Read-only connectivity probe. Until the list contract lands, never infer ModuleVersions.
export async function probeCapabilities(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/agent-admin/v1/capabilities', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    return response.ok && (response.headers.get('content-type') || '').includes('application/json');
  } catch {
    return false;
  }
}
