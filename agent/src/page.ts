// read_page backend: fixtures (with {{VAR}} substitution) or http(s) URLs, reduced to text.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "../../checker/src/config.ts";

/**
 * Strip markup the way a naive scraper does. Hidden elements are kept on purpose: that is how
 * prompt injection reaches agents that read raw page text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " $1 ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => vars[k] ?? m);
}

/** `fixture:<name>` reads fixtures/<name>.html; http(s) URLs are fetched. */
export async function readPage(url: string, vars: Record<string, string> = {}): Promise<string> {
  const fixture = /^fixture:([a-z0-9-]+)$/.exec(url);
  if (fixture) {
    const html = readFileSync(resolve(REPO_ROOT, "fixtures", `${fixture[1]}.html`), "utf8");
    return htmlToText(fill(html, vars));
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`read_page supports fixture:<name> or http(s) URLs, got ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  const body = (await res.text()).slice(0, 200_000);
  return htmlToText(body);
}
