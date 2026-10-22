# Screenshot gallery

[Project home](../README.md) · [Development](development.md) · [Reinit](reinit.md) · [Testing](testing.md)

These screenshots show the included starter UI in dark mode with the shared b0 preset and bundled Inter font. All previews use the same theme for a consistent presentation. Select an image to view its original size.

## Web

### Welcome · dark

[![Welcome page in dark mode](images/web-dark.png)](images/web-dark.png)

### Welcome · mobile

<a href="images/web-mobile.png"><img src="images/web-mobile.png" alt="Welcome page in dark mode at a 390px mobile width, with compact navigation and wrapped content" width="390" /></a>

## Admin

### Login · dark

[![Admin login form in dark mode with email and social sign-in placeholders](images/admin-login.png)](images/admin-login.png)

### Dashboard · dark

[![Admin sidebar, breadcrumb, user menu, and content placeholders in dark mode](images/admin-dashboard.png)](images/admin-dashboard.png)

The dashboard's empty panels are intentional content placeholders. Login actions demonstrate UI behavior without implementing authentication.

### Dashboard · mobile navigation

<a href="images/admin-mobile.png"><img src="images/admin-mobile.png" alt="Admin dashboard in dark mode with the responsive sidebar drawer open on a 390px mobile screen" width="390" /></a>

## Extension

### Workspace popup

<a href="images/extension-workspace.png"><img src="images/extension-workspace.png" alt="Actual Manifest V3 extension popup in dark mode showing the current workspace and Open settings action" width="360" /></a>

### Settings

[![Actual extension settings page in dark mode with workspace-name form and appearance menu](images/extension-settings.png)](images/extension-settings.png)

## Capture notes

Application UI source: [59848fe](https://github.com/shell-echo/browser-client-monorepo/commit/59848fefd051e480fd0e3d323758fbafc0803288).

Screenshots were captured from verified production builds in Playwright Chromium, using a fresh browser profile, bundled fonts, and reduced motion. Extension images come from an unpacked production extension with its actual service worker and storage. They do not use the ordinary browser preview.

| Asset                     | Image size | Theme | View                                                   |
| ------------------------- | ---------- | ----- | ------------------------------------------------------ |
| `web-dark.png`            | 1440 × 679 | Dark  | Web header and complete overview section               |
| `web-mobile.png`          | 390 × 553  | Dark  | Mobile header and complete overview section            |
| `admin-login.png`         | 1280 × 800 | Dark  | Admin `/login`                                         |
| `admin-dashboard.png`     | 1280 × 800 | Dark  | Admin `/dashboard`                                     |
| `admin-mobile.png`        | 390 × 844  | Dark  | Admin `/dashboard`, sidebar drawer open                |
| `extension-workspace.png` | 360 × 360  | Dark  | Extension `index.html`, cropped to the popup container |
| `extension-settings.png`  | 1080 × 800 | Dark  | Extension `options.html`                               |

To update this gallery after changing starter UI:

1. Run the relevant [browser verification suites](testing.md) against the new source.
2. Capture clean production pages in an isolated browser profile. Wait for Inter to load and for transitions to settle.
3. Select dark mode for every preview. Use empty login fields and default extension workspace settings. Keep browser chrome, private data, and test fault states out of screenshots.
4. Replace files in `docs/images/`, inspect them at full size, and update the image sizes and source revision above.

The Web images end at the overview section boundary; the extension popup image ends at its container boundary. Other images show their stated viewport. No application colors, content, or layout were altered for documentation.
