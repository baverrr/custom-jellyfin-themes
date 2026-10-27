# Security Policy

## Supported versions

The latest commit on `main`, tested against Jellyfin 12.2.

## What's in scope

These themes are CSS, images and one optional script (`themes/effects.js`) that runs in the viewer's browser.
Relevant problems include:

- anything in `effects.js` that could run untrusted content, for example inserting item names as HTML
- anything that makes a request to a server the documentation doesn't list (see [PRIVACY.md](PRIVACY.md))
- personal or secret data committed to this repository by mistake

Jellyfin itself and its plugins are out of scope: report those to their own projects.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (the **Security** tab > **Report a vulnerability**)
instead of a public issue. Include what you found, how to reproduce it and the theme or file involved. You'll get
a reply within a week.

## Keeping your install safe

- Mount the theme folder **read-only** (`:ro`), as the install guide shows.
- Only load `effects.js` from your own server, never from a third-party URL.
- Review changes before you pull a new version.
