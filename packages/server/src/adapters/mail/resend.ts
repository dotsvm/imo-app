/** Resend delivers our rendered templates. Its Idempotency-Key header makes
    a retried send deliver once. */
import type { MailMessage, Mailer } from "@imo/core/ports/platform";
import type { HttpClient } from "@imo/core/ports/runtime";

export type MailRenderer = (
  template: string,
  data: Record<string, unknown>,
  unsubscribeUrl?: string,
) => { subject: string; html: string; text: string };

/** The hosts this adapter calls, for the egress allowlist. */
export const RESEND_HOSTS = ["api.resend.com"];

export class ResendMailer implements Mailer {
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
    private readonly from: string,
    private readonly render: MailRenderer,
  ) {}

  async send(message: MailMessage) {
    const { subject, html, text } = this.render(message.template, message.data, message.unsubscribeUrl);
    await this.http.json("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "idempotency-key": message.idempotencyKey.slice(0, 256),
      },
      body: {
        from: this.from,
        to: [message.to],
        subject,
        html,
        text,
        ...(message.unsubscribeUrl && {
          headers: {
            "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      },
      timeoutMs: 10_000,
      idempotent: true,
    });
  }
}
