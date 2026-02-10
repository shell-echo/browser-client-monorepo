class UtilsHelper {
  isRestrictedUrl = (url: string) => {
    if (!url) return true;
    if (url === "about:blank") return true;
    if (/^chrome-error:/i.test(url)) return true;
    if (/^(chrome|edge|about|view-source|devtools):/i.test(url)) return true;
    if (/^chrome-extension:\/\//i.test(url) && !url.startsWith("chrome-extension://")) return true;

    return false;
  };
}

export default UtilsHelper;
