/**
 * Our email templates. Providers only deliver: every message is rendered
 * here, the same way whichever provider sends it. Plain, accessible HTML with
 * a text part; no tracking pixels.
 */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const escape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function layout(appUrl: string, heading: string, body: string, action?: { label: string; href: string }, unsubscribe?: string) {
  const button = action
    ? `<p style="margin:28px 0 8px"><a href="${escape(action.href)}" style="display:inline-block;background:#3ddc84;color:#08130c;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escape(action.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#0e0f13;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#16181f;border-radius:16px;padding:28px;color:#e8e9ed">
<tr><td>
<img src="${escape(appUrl)}/brand/wordmark-email.png" width="120" height="42" alt="imo" style="display:block;border:0;margin:0 0 20px;height:42px;width:120px;font-weight:700;font-size:18px;color:#e8e9ed">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#ffffff">${escape(heading)}</h1>
<div style="font-size:15px;line-height:1.55;color:#c3c6d0">${body}</div>
${button}
<p style="margin:28px 0 0;font-size:12px;color:#7d8190">Paper trading on live venue prices. Change which emails you get in Settings${
    unsubscribe ? `, or <a href="${escape(unsubscribe)}" style="color:#7d8190">unsubscribe from these</a>` : ""
  }.</p>
</td></tr></table></td></tr></table></body></html>`;
}

type Renderer = (data: Record<string, unknown>, appUrl: string, unsubscribe?: string) => RenderedMail;

interface DigestItem {
  author: string;
  market: string;
  outcome: string;
  entryCents: number;
  snippet: string;
  href: string;
}

const TEMPLATES: Record<string, Renderer> = {
  "verify-email": (data, appUrl) => ({
    subject: "Confirm your email for imo",
    html: layout(
      appUrl,
      "Confirm your email",
      `<p style="margin:0">Hi ${escape(data.name)}, confirm this address to get order, resolution and digest emails. The link works for 48 hours.</p>`,
      { label: "Confirm email", href: String(data.link) },
    ),
    text: `Confirm your email for imo: ${data.link}\n\nThe link works for 48 hours.`,
  }),
  invite: (data, appUrl) => {
    const link = `${appUrl}/?login=1&invite=${encodeURIComponent(String(data.code))}`;
    return {
      subject: "You're invited to imo",
      html: layout(
        appUrl,
        "You're in",
        `<p style="margin:0 0 12px">imo is paper trading on live prediction-market prices — post a call, back it, and build a record people can check.</p>
<p style="margin:0">Your invite code: <strong style="color:#ffffff;letter-spacing:0.08em">${escape(data.code)}</strong></p>`,
        { label: "Accept your invite", href: link },
      ),
      text: `You're invited to imo.\n\nYour code: ${data.code}\n${link}`,
    };
  },
  notification: (data, appUrl, unsubscribe) => {
    const href = `${appUrl}${data.href ?? "/"}`;
    const cta = (data.cta as { label: string; href: string } | undefined) ?? { label: "Open imo", href: String(data.href ?? "/") };
    return {
      subject: String(data.title),
      html: layout(
        appUrl,
        String(data.title),
        `<p style="margin:0">${escape(data.body)}</p>`,
        { label: cta.label, href: `${appUrl}${cta.href}` },
        unsubscribe,
      ),
      text: `${data.title}\n\n${data.body}\n\n${href}${unsubscribe ? `\n\nUnsubscribe: ${unsubscribe}` : ""}`,
    };
  },
  digest: (data, appUrl, unsubscribe) => {
    const items = data.items as DigestItem[];
    const more = Number(data.more ?? 0);
    const rows = items
      .map(
        (i) => `<tr><td style="padding:12px 0;border-top:1px solid #262a35">
<p style="margin:0 0 4px;font-size:13px;color:#7d8190">${escape(i.author)} · ${escape(i.market)}</p>
<p style="margin:0 0 6px;color:#e8e9ed"><strong>${escape(i.outcome)}</strong> at ${escape(i.entryCents)}¢</p>
<p style="margin:0;font-size:14px;color:#c3c6d0">${escape(i.snippet)} <a href="${escape(appUrl + i.href)}" style="color:#3ddc84">Read</a></p>
</td></tr>`,
      )
      .join("");
    const subject = items.length === 1 ? `${items[0].author} posted a prediction` : `${items.length + more} new predictions from traders you follow`;
    return {
      subject,
      html: layout(
        appUrl,
        "From traders you follow",
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${
          more ? `<p style="margin:12px 0 0;font-size:13px;color:#7d8190">And ${more} more in your feed.</p>` : ""
        }`,
        { label: "Open your feed", href: `${appUrl}/feed?tab=Following` },
        unsubscribe,
      ),
      text: [
        "From traders you follow:",
        ...items.map((i) => `- ${i.author} · ${i.market}: ${i.outcome} at ${i.entryCents}¢ — ${i.snippet} ${appUrl}${i.href}`),
        more ? `And ${more} more.` : "",
        unsubscribe ? `Unsubscribe: ${unsubscribe}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },
};

export function renderMail(template: string, data: Record<string, unknown>, appUrl: string, unsubscribe?: string): RenderedMail {
  const render = TEMPLATES[template];
  if (!render) throw new Error(`No email template ${template}`);
  return render(data, appUrl.replace(/\/+$/, ""), unsubscribe);
}
