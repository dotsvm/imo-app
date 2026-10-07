/**
 * A scripted HttpClient for adapter tests: requests are matched against
 * recorded responses, and anything unexpected fails loudly. Venue adapters run
 * their conformance kit against recordings through this.
 */
import {
  HttpError,
  type HttpClient,
  type HttpRequest,
} from "@imo/core/ports/runtime";

export interface Recording {
  method?: string;
  /** Exact URL, or a pattern for URLs with changing query strings. */
  url: string | RegExp;
  status?: number;
  /** A value, or a function of the URL for responses built from recordings. */
  body: unknown | ((url: string) => unknown);
}

export class ScriptedHttp implements HttpClient {
  readonly calls: { url: string; request?: HttpRequest }[] = [];
  constructor(private readonly recordings: Recording[]) {}

  async json(url: string, request?: HttpRequest) {
    this.calls.push({ url, request });
    const method = request?.method ?? "GET";
    const match = this.recordings.find(
      (r) =>
        (r.method ?? "GET") === method &&
        (typeof r.url === "string" ? r.url === url : r.url.test(url)),
    );
    if (!match) throw new Error(`No recording for ${method} ${url}`);
    const status = match.status ?? 200;
    if (status >= 400)
      throw new HttpError(status, url, JSON.stringify(match.body));
    const body =
      typeof match.body === "function"
        ? (match.body as (url: string) => unknown)(url)
        : match.body;
    return structuredClone(body);
  }
}
