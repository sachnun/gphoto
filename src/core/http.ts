export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string | Blob;
  timeoutMs?: number;
  proxy?: string;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function request(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body as BodyInit | undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    proxy: options.proxy,
  } as RequestInit);

  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    bytes: buffer,
    text: new TextDecoder().decode(buffer),
  };
}

export async function requestOk(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
  const response = await request(url, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} for ${url}: ${response.text.slice(0, 200)}`);
  }
  return response;
}
