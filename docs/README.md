# Documentation

**English** · [简体中文](zh-CN/README.md) · [Project home](../README.md)

Choose a guide for the task you are working on. All commands run from the repository root.

| Guide                                                 | What it covers                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Development](development.md)                         | Application templates, shared UI and tooling, themes, and extension development    |
| [Applications](applications.md)                       | Registry, instance identity, add/remove/restore, and multiple instances            |
| [Extension communication](extension-communication.md) | Native Ports, SDK usage, user approval, exact-origin policies, routing, and limits |
| [Reinit](reinit.md)                                   | Official template refresh, dependency policy, preservation, recovery, and cleanup  |
| [Testing and CI](testing.md)                          | Unit tests, browser assertions, accessibility, resource guards, and workflows      |
| [Deployment and delivery](deployment.md)              | Next.js hosting, Admin SPA routing, environment inputs, and Extension ZIPs         |
| [Dependency security](security.md)                    | Audits, local patches, upstream fixes, and scheduled checks                        |
| [Screenshot gallery](previews.md)                     | Starter UI, mobile layouts, capture sources, and image dimensions                  |

English guides live directly in `docs/`; Simplified Chinese guides live in `docs/zh-CN/`. Each guide links to its counterpart. Update both versions together when commands, behavior, or safety boundaries change. Keep code identifiers and product UI labels unchanged so readers can find the corresponding control or file. Share the existing images instead of duplicating them.

The root README and these guides are the maintained project documentation. Application `README.md` files are generated framework entry points and can be replaced by `reinit`; keep persistent instructions here.
