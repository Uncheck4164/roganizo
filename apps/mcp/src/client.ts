const SESSION_COOKIE = "roganizo_session";

/**
 * A finished request. Failures are values, not exceptions: the whole point of
 * this MCP is to make a broken instance legible, so the HTTP status and the
 * response body have to survive all the way to the tool output.
 */
export type Fetched<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; body: string };

/** Enough of the body to identify an error without flooding the transcript. */
const MAX_BODY = 600;

function truncate(text: string): string {
  const flat = text.trim();
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY)}… (${flat.length} bytes)` : flat;
}

export class RoganizoClient {
  #cookie: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string | undefined,
  ) {}

  get instance(): string {
    return this.baseUrl;
  }

  /** Exchanges the web password for a session cookie. */
  async login(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.password) {
      return {
        ok: false,
        reason:
          "No password configured. Set ROGANIZO_PASSWORD (see apps/mcp/.env.example) to the web password of this instance.",
      };
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.password }),
      });
    } catch (err) {
      return { ok: false, reason: `${this.baseUrl} is unreachable: ${(err as Error).message}` };
    }

    if (res.status === 409) {
      return { ok: false, reason: "The instance has no password yet: finish setup in the browser first." };
    }
    if (res.status === 401) {
      return { ok: false, reason: "Wrong web password for this instance (HTTP 401)." };
    }
    if (!res.ok) {
      return { ok: false, reason: `Login failed with HTTP ${res.status}: ${truncate(await res.text())}` };
    }

    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) {
      return { ok: false, reason: "Login returned 200 but no session cookie was set." };
    }
    this.#cookie = cookie;
    return { ok: true };
  }

  /**
   * GET on the instance. Authenticated by default; logs in on demand and once
   * more if the session turns out to be stale (the server restarts on every
   * settings change, but the signing secret is persisted so this is rare).
   */
  async get<T>(path: string, opts: { auth?: boolean } = {}): Promise<Fetched<T>> {
    const auth = opts.auth !== false;
    if (auth && !this.#cookie) {
      const login = await this.login();
      if (!login.ok) return { ok: false, status: 0, body: login.reason };
    }

    let res = await this.#raw(path, auth);
    if (res instanceof Error) return { ok: false, status: 0, body: res.message };

    if (auth && res.status === 401) {
      this.#cookie = undefined;
      const login = await this.login();
      if (!login.ok) return { ok: false, status: 401, body: login.reason };
      const retry = await this.#raw(path, auth);
      if (retry instanceof Error) return { ok: false, status: 0, body: retry.message };
      res = retry;
    }

    if (!res.ok) return { ok: false, status: res.status, body: truncate(await res.text()) };

    const text = await res.text();
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) as T };
    } catch {
      // A 200 that is not JSON means the SPA fallback swallowed the route.
      return { ok: false, status: res.status, body: `expected JSON, got: ${truncate(text)}` };
    }
  }

  /**
   * POST on the instance. Unlike {@link get} a 422 is not a transport failure:
   * it is the server refusing a plan it validated, and the body explains why,
   * so it comes back as a normal result for the caller to render.
   */
  async post<T>(path: string, body: unknown): Promise<Fetched<T>> {
    if (!this.#cookie) {
      const login = await this.login();
      if (!login.ok) return { ok: false, status: 0, body: login.reason };
    }

    let res = await this.#raw(path, true, body);
    if (res instanceof Error) return { ok: false, status: 0, body: res.message };

    if (res.status === 401) {
      this.#cookie = undefined;
      const login = await this.login();
      if (!login.ok) return { ok: false, status: 401, body: login.reason };
      const retry = await this.#raw(path, true, body);
      if (retry instanceof Error) return { ok: false, status: 0, body: retry.message };
      res = retry;
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, body: `expected JSON, got: ${truncate(text)}` };
    }
    // 422 carries the validated plan, which the caller needs to see in full.
    if (!res.ok && res.status !== 422) return { ok: false, status: res.status, body: truncate(text) };
    return { ok: true, status: res.status, data: data as T };
  }

  async #raw(path: string, auth: boolean, body?: unknown): Promise<Response | Error> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(auth && this.#cookie ? { Cookie: this.#cookie } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      return new Error(`${this.baseUrl}${path} is unreachable: ${(err as Error).message}`);
    }
  }
}
