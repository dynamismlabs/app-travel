/**
 * Reading mail for Travel: addresses, MIME words, HTML bodies, calendar
 * invitations and Gmail's full message format, as Ri's Gmail tools return
 * them through the hub (`gmail__read_message`, `gmail__get_message`). Pure
 * functions with no I/O. They came from Ri's old app kit, which Travel no
 * longer uses; the kit's connector client returns only plain text, so Travel
 * keeps its own reader for attachments and invitations.
 */
import { z } from "zod/v3";
import { nowIso, sha256 } from "./data.js";

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface MailAddress {
  name: string | null;
  /** As written, trimmed. */
  address: string;
  /** Trimmed with a lower-case domain. Local parts keep dots, plus suffixes and case. */
  normalized: string;
}
/** Trim and lower-case only the domain. Never strips dots or plus suffixes. */
export function normalizeEmail(address: string): string {
  const value = address.trim();
  const at = value.lastIndexOf("@");
  return at < 1 ? value : `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}
export function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  return at < 1 ? null : address.slice(at + 1).trim().toLowerCase() || null;
}
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "fastmail.com", "hey.com", "zoho.com", "yandex.com", "mail.com", "qq.com", "163.com"]);
/** A shared mail provider never identifies an employer. */
export function isPersonalMailDomain(domain: string | null): boolean {
  return !!domain && FREE_MAIL.has(domain.toLowerCase());
}
const ROLE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|mailer-daemon|postmaster|bounce[s]?|news(letter)?|marketing|updates?|info|support|help|hello|team|contact|billing|accounts?|admin|sales|jobs|careers|recruiting|hr|press|service|customerservice|reservations?|bookings?|confirmations?|receipts?|orders?)$/i;
/** A no-reply or automated sender address. */
export function isNoReply(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf("@")).toLowerCase();
  return /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounces?)([._+-]|$)/.test(local);
}
/** A shared role mailbox such as support@ or team@, not one person. */
export function isRoleAddress(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf("@"));
  return ROLE_LOCAL.test(local.split("+")[0]);
}

/** Decode RFC 2047 encoded words (=?UTF-8?B?...?= and =?charset?Q?...?=). */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes = encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
        return decodeBytes(bytes, charset);
      } catch {
        return whole;
      }
    });
}
function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase() || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
/** Parse an RFC 5322 address list, including quoted names, comments and groups. */
export function parseAddressList(value: string | null | undefined): MailAddress[] {
  if (!value) return [];
  const text = decodeMimeWords(value).slice(0, 20000);
  const items: string[] = [];
  let current = "", quoted = false, angle = 0, comment = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && quoted) { current += char + (text[++index] ?? ""); continue; }
    if (char === '"' && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment++;
    else if (!quoted && char === ")" && comment) comment--;
    else if (!quoted && !comment && char === "<") angle++;
    else if (!quoted && !comment && char === ">" && angle) angle--;
    if (!quoted && !comment && !angle && (char === "," || char === ";")) { items.push(current); current = ""; continue; }
    if (!quoted && !comment && !angle && char === ":" ) { current = ""; continue; } // group display name
    current += char;
  }
  items.push(current);
  const result: MailAddress[] = [];
  for (const raw of items) {
    const item = raw.replace(/\((?:[^()\\]|\\.)*\)/g, " ").trim();
    if (!item) continue;
    const angled = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(item);
    const address = (angled ? angled[2] : item).trim().replace(/^mailto:/i, "");
    if (!/^[^\s@]+@[^\s@]+$/.test(address) || address.length > 320) continue;
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim() || null : null;
    result.push({ name: name && name !== address ? name.slice(0, 300) : null, address, normalized: normalizeEmail(address) });
    if (result.length >= 500) break;
  }
  return result;
}

// ─── Messages ────────────────────────────────────────────────────────────────

type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[]; partId?: string };
const rawMessage = z.object({
  id: z.string(), threadId: z.string().optional(), historyId: z.string().optional(), internalDate: z.string().optional(),
  snippet: z.string().optional(), labelIds: z.array(z.string()).optional(), payload: z.unknown().optional(), sizeEstimate: z.number().optional(),
}).passthrough();
export interface MailAttachment { attachmentId: string | null; filename: string; mimeType: string; size: number; partId: string | null }
export interface CalendarInvite { method: string | null; uid: string | null; summary: string | null; start: string | null; end: string | null; status: string | null; sequence: number | null; organizer: string | null; attendees: string[] }
export interface MailMessage {
  id: string;
  threadId: string;
  historyId: string | null;
  /** When Gmail received it, from internalDate. */
  receivedAt: string;
  labelIds: string[];
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  dateHeader: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  listId: string | null;
  /** Mail the owner sent from this account. */
  sent: boolean;
  draft: boolean;
  /** In Trash or Spam: treat as unavailable evidence. */
  discarded: boolean;
  /** Why this looks like bulk or automated mail, from headers and labels before any AI. Empty for ordinary mail. */
  bulkReasons: string[];
  text: string;
  textTruncated: boolean;
  /** The plain text came from an HTML part. */
  fromHtml: boolean;
  attachments: MailAttachment[];
  invite: CalendarInvite | null;
  snippet: string;
  /** Digest of the identity, headers and text. Unchanged content keeps the same digest. */
  digest: string;
}
function header(part: Part | undefined, name: string): string | null {
  const found = part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}
function charsetOf(part: Part): string {
  return /charset="?([^";]+)"?/i.exec(header(part, "Content-Type") ?? "")?.[1] ?? "utf-8";
}
function bodyText(part: Part): string {
  if (!part.body?.data) return "";
  return decodeBytes(Buffer.from(part.body.data, "base64url"), charsetOf(part));
}
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: "(c)", reg: "(R)", trade: "TM", euro: "EUR", pound: "GBP" };
/** Readable text from an HTML email body. Drops scripts, styles and markup. */
export function htmlToText(html: string): string {
  return html
    .slice(0, 2_000_000)
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " \t")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Remove quoted earlier messages so evidence shows what this message said. */
export function withoutQuotedReply(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .{4,200} wrote:\s*$/.test(line.trim()) || /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(line.trim()) || /^From: .+$/.test(line.trim()) && out.length > 3) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
/** A minimal text/calendar reader for the first event of an invitation part. */
export function parseCalendarInvite(ics: string): CalendarInvite | null {
  const unfolded = ics.slice(0, 200_000).replace(/\r?\n[ \t]/g, "");
  const event = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/.exec(unfolded)?.[1];
  if (!event) return null;
  const field = (source: string, name: string) => new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, "mi").exec(source)?.[1]?.trim() ?? null;
  const time = (name: string) => {
    const line = new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "mi").exec(event);
    if (!line) return null;
    const zone = /TZID=([^;:]+)/i.exec(line[1])?.[1];
    const value = line[2].trim();
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
    if (!match) return value;
    const [, y, mo, d, h, mi, s, z] = match;
    if (!h) return `${y}-${mo}-${d}`;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : zone ? `[${zone}]` : ""}`;
  };
  const attendees = [...event.matchAll(/^ATTENDEE[^:\n]*:mailto:(.*)$/gim)].map((match) => normalizeEmail(match[1])).slice(0, 200);
  const sequence = field(event, "SEQUENCE");
  return {
    method: field(unfolded, "METHOD"),
    uid: field(event, "UID"),
    summary: field(event, "SUMMARY")?.replace(/\\,/g, ",").replace(/\\n/gi, " ") ?? null,
    start: time("DTSTART"),
    end: time("DTEND"),
    status: field(event, "STATUS"),
    sequence: sequence && /^\d+$/.test(sequence) ? Number(sequence) : null,
    organizer: (/^ORGANIZER[^:\n]*:mailto:(.*)$/im.exec(event)?.[1] ?? null)?.trim() ?? null,
    attendees,
  };
}
const BULK_LABELS: Record<string, string> = { CATEGORY_PROMOTIONS: "promotions", CATEGORY_SOCIAL: "social", CATEGORY_FORUMS: "forums" };
/** Parse a `gmail.read_message` result into a bounded, typed message. */
export function parseGmailMessage(raw: unknown, options: { maxText?: number } = {}): MailMessage {
  const message = rawMessage.parse(raw);
  const payload = (message.payload ?? {}) as Part;
  const maxText = options.maxText ?? 64_000;
  let plain = "", html = "", invite: CalendarInvite | null = null;
  const attachments: MailAttachment[] = [];
  let visited = 0;
  const walk = (part: Part, depth: number) => {
    if (depth > 30 || ++visited > 2000) return;
    const type = (part.mimeType ?? "").toLowerCase();
    const disposition = (header(part, "Content-Disposition") ?? "").toLowerCase();
    if (part.filename || disposition.startsWith("attachment") || part.body?.attachmentId) {
      if (part.filename || part.body?.attachmentId)
        attachments.push({ attachmentId: part.body?.attachmentId ?? null, filename: (part.filename || "attachment").slice(0, 300), mimeType: type || "application/octet-stream", size: part.body?.size ?? 0, partId: part.partId ?? null });
      if (type === "text/calendar" && part.body?.data && !invite) invite = parseCalendarInvite(bodyText(part));
      return;
    }
    if (type === "text/plain" && !plain) plain = bodyText(part);
    else if (type === "text/html" && !html) html = bodyText(part);
    else if (type === "text/calendar" && !invite) invite = parseCalendarInvite(bodyText(part));
    for (const child of part.parts ?? []) walk(child, depth + 1);
  };
  walk(payload, 0);
  const fromHtml = !plain.trim() && !!html;
  const full = (fromHtml ? htmlToText(html) : plain).replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  const text = full.length > maxText ? full.slice(0, maxText) : full;
  const labelIds = message.labelIds ?? [];
  const from = parseAddressList(header(payload, "From"))[0] ?? null;
  const listId = header(payload, "List-Id");
  const precedence = header(payload, "Precedence")?.toLowerCase() ?? null;
  const autoSubmitted = header(payload, "Auto-Submitted")?.toLowerCase() ?? null;
  const bulkReasons: string[] = [];
  if (listId) bulkReasons.push("mailing list");
  if (header(payload, "List-Unsubscribe")) bulkReasons.push("unsubscribe link");
  if (precedence && ["bulk", "list", "junk"].includes(precedence)) bulkReasons.push(`precedence ${precedence}`);
  if (autoSubmitted && autoSubmitted !== "no") bulkReasons.push("automated");
  if (from && isNoReply(from.address)) bulkReasons.push("no-reply sender");
  for (const label of labelIds) if (BULK_LABELS[label]) bulkReasons.push(BULK_LABELS[label]);
  const subject = decodeMimeWords(header(payload, "Subject") ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  const internal = Number(message.internalDate);
  const receivedAt = Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : (() => {
    const parsed = Date.parse(header(payload, "Date") ?? "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso();
  })();
  const references = (header(payload, "References") ?? "").match(/<[^<>\s]+>/g)?.slice(-50) ?? [];
  const parsed: Omit<MailMessage, "digest"> = {
    id: message.id,
    threadId: message.threadId ?? message.id,
    historyId: message.historyId ?? null,
    receivedAt,
    labelIds,
    subject,
    from,
    to: parseAddressList(header(payload, "To")),
    cc: parseAddressList(header(payload, "Cc")),
    bcc: parseAddressList(header(payload, "Bcc")),
    replyTo: parseAddressList(header(payload, "Reply-To")),
    dateHeader: header(payload, "Date"),
    messageId: header(payload, "Message-ID") ?? header(payload, "Message-Id"),
    inReplyTo: header(payload, "In-Reply-To"),
    references,
    listId,
    sent: labelIds.includes("SENT"),
    draft: labelIds.includes("DRAFT"),
    discarded: labelIds.includes("TRASH") || labelIds.includes("SPAM"),
    bulkReasons,
    text,
    textTruncated: full.length > maxText,
    fromHtml,
    attachments: attachments.slice(0, 50),
    invite,
    snippet: decodeMimeWords(message.snippet ?? "").slice(0, 500),
  };
  return { ...parsed, digest: sha256(JSON.stringify([parsed.id, parsed.subject, parsed.from?.normalized, parsed.to.map((a) => a.normalized), parsed.text, parsed.attachments.map((a) => [a.filename, a.size])])) };
}
/** Headers from `gmail.get_message` metadata, for a cheap relevance check before reading a body. */
export interface MailHeaders { id: string; threadId: string; labelIds: string[]; subject: string; from: MailAddress | null; to: MailAddress[]; cc: MailAddress[]; snippet: string; listId: string | null }
export function parseMetadata(raw: unknown): MailHeaders {
  const value = z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional(), snippet: z.string().optional(), headers: z.record(z.string(), z.string()).optional() }).passthrough().parse(raw);
  const headers = value.headers ?? {};
  return {
    id: value.id, threadId: value.threadId ?? value.id, labelIds: value.labelIds ?? [], subject: decodeMimeWords(headers.Subject ?? ""),
    from: parseAddressList(headers.From)[0] ?? null, to: parseAddressList(headers.To), cc: parseAddressList(headers.Cc), snippet: value.snippet ?? "",
    listId: null,
  };
}


/**
 * A message from the kit's mail capability (`connectors(ctx).mail()`), which
 * any hub offers: headers and plain text, without Gmail's MIME parts. It
 * carries no attachments, invitations or list headers.
 */
export function fromCapabilityMessage(message: { id: string; threadId?: string; from: { name?: string; email: string } | null; to: { name?: string; email: string }[]; cc: { name?: string; email: string }[]; subject: string; date: string | null; snippet: string; text?: string; labels: string[] }, now = new Date()): MailMessage {
  const address = (item: { name?: string; email: string }): MailAddress => ({ name: item.name ?? null, address: item.email, normalized: normalizeEmail(item.email) });
  const from = message.from ? address(message.from) : null;
  const text = (message.text ?? message.snippet ?? "").replace(/\r\n/g, "\n").replace(/\u0000/g, "").slice(0, 64_000);
  const labelIds = message.labels ?? [];
  const parsed: Omit<MailMessage, "digest"> = {
    id: message.id, threadId: message.threadId ?? message.id, historyId: null,
    receivedAt: message.date ?? now.toISOString(), labelIds, subject: message.subject.replace(/\s+/g, " ").trim().slice(0, 1000),
    from, to: message.to.map(address), cc: message.cc.map(address), bcc: [], replyTo: [], dateHeader: message.date, messageId: null, inReplyTo: null, references: [], listId: null,
    sent: labelIds.includes("SENT"), draft: labelIds.includes("DRAFT"), discarded: labelIds.includes("TRASH") || labelIds.includes("SPAM"),
    bulkReasons: from && isNoReply(from.address) ? ["no-reply sender"] : [], text, textTruncated: (message.text ?? "").length > 64_000, fromHtml: false,
    attachments: [], invite: null, snippet: message.snippet.slice(0, 500),
  };
  return { ...parsed, digest: sha256(JSON.stringify([parsed.id, parsed.subject, parsed.from?.normalized, parsed.to.map((a) => a.normalized), parsed.text, []])) };
}
