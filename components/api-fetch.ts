export async function apiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {})
    }
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof json?.error === "string" ? json.error : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return json as T;
}
