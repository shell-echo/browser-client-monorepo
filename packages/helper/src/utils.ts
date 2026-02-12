class UtilsHelper {
  public isRestrictedUrl = (url: string) => {
    if (!url) return true;
    if (url === "about:blank") return true;
    if (/^chrome-error:/i.test(url)) return true;
    if (/^(chrome|edge|about|view-source|devtools):/i.test(url)) return true;
    if (/^chrome-extension:\/\//i.test(url) && !url.startsWith("chrome-extension://")) return true;

    return false;
  };

  public arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
  };

  public base64ToArrayBuffer = (base64: string) => {
    const comma = base64.indexOf(",");
    const cleaned = (comma >= 0 ? base64.slice(comma + 1) : base64).trim().replace(/-/g, "+").replace(/_/g, "/");

    const pad = cleaned.length % 4;
    const padded = pad ? cleaned + "=".repeat(4 - pad) : cleaned;

    const binary = atob(padded);
    const len = binary.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
  };

  public sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default UtilsHelper;
