export function normalizeCampayPhone(value: unknown): string | null {
  let digits = String(value || "").trim().replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^0?6\d{8}$/.test(digits)) {
    digits = `237${digits.replace(/^0/, "")}`;
  }
  return /^2376\d{8}$/.test(digits) ? digits : null;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyCampayCallbackSignature(
  signature: string | null,
  webhookKey: string | undefined,
): Promise<boolean> {
  if (!signature || !webhookKey) return false;
  const parts = signature.trim().split(".");
  if (parts.length !== 3) return false;

  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    if (header.alg !== "HS256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

