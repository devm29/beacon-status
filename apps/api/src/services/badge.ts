import type { OverallStatus, PublicComponent } from "@beacon/shared";

const OVERALL: Record<OverallStatus, { text: string; color: string }> = {
  operational: { text: "operational", color: "#248a3d" },
  degraded: { text: "degraded", color: "#c93400" },
  partial_outage: { text: "partial outage", color: "#c93400" },
  major_outage: { text: "major outage", color: "#d70015" },
  maintenance: { text: "maintenance", color: "#0071e3" },
};

const COMPONENT: Record<PublicComponent["status"], { text: string; color: string }> = {
  operational: OVERALL.operational,
  degraded: OVERALL.degraded,
  outage: { text: "outage", color: "#d70015" },
  maintenance: OVERALL.maintenance,
  unknown: { text: "unknown", color: "#6e6e73" },
};

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );

/** Approximates Verdana 11px glyph widths closely enough for shields-style badges. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text)
    width += /[A-Z]/.test(char) ? 7.5 : /[mw]/.test(char) ? 9 : /[ilj.,: ]/.test(char) ? 3.5 : 6.4;
  return Math.ceil(width);
}

export function renderBadge(label: string, message: string, color: string): string {
  const labelWidth = textWidth(label) + 14;
  const messageWidth = textWidth(message) + 14;
  const width = labelWidth + messageWidth;
  const safeLabel = escapeXml(label);
  const safeMessage = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${safeLabel}: ${safeMessage}">
<title>${safeLabel}: ${safeMessage}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient>
<clipPath id="r"><rect width="${width}" height="20" rx="4" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#3a3a3c"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Verdana,Geneva,sans-serif" font-size="11">
<text x="${labelWidth / 2}" y="14">${safeLabel}</text><text x="${labelWidth + messageWidth / 2}" y="14">${safeMessage}</text>
</g></svg>`;
}

export function overallBadge(label: string, status: OverallStatus): string {
  const { text, color } = OVERALL[status];
  return renderBadge(label, text, color);
}

export function componentBadge(label: string, status: PublicComponent["status"]): string {
  const { text, color } = COMPONENT[status];
  return renderBadge(label, text, color);
}
