# Privacy Policy

_Last updated: 27 October 2026_

Custom Jellyfin Themes is a set of stylesheets, images, one font and one optional script that you install on your
own Jellyfin server. This page explains what they do and don't do with information about you and the people who
use your server.

## What the themes collect

**Nothing.** The themes and `effects.js`:

- collect, store or send no personal data
- contain no analytics, telemetry, tracking pixels or advertising
- set no cookies and write nothing to `localStorage`, `sessionStorage` or IndexedDB
- make no network requests to the author or to anyone else

`effects.js` only reads the page that is already open in the browser (which theme is active, where the pointer
is, the names of the cards on screen) to draw its animations. That stays in the browser and is gone when the
tab closes.

## Third-party requests

The Custom CSS, [`custom-css/aurora-glass.css`](custom-css/aurora-glass.css), imports these files from public
servers. When a browser loads a Jellyfin page, it asks those servers for the files, and they receive the usual
request data: the viewer's IP address, browser user agent and the page's address as the referrer.

| Provider | What it serves | Privacy policy |
|---|---|---|
| jsDelivr (`cdn.jsdelivr.net`) | ElegantFin, elegantfin-jf12 and the Intro Skipper button stylesheets | <https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net> |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | Bricolage Grotesque and Instrument Serif | <https://developers.google.com/fonts/faq/privacy> |

The theme folder itself makes no third-party requests: its font and images are served by your own server.

**Keeping everything on your server.** Download those files, serve them from your Jellyfin server and change the
`@import` lines at the top of `aurora-glass.css` to their local addresses. After that no request leaves your
server.

## Jellyfin and GitHub

Your Jellyfin server and any plugins you run follow their own privacy practices, which these themes don't change.
This repository is hosted on GitHub, and browsing it is covered by the
[GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Changes

Any change to this policy is recorded in this file's history and noted in [CHANGELOG.md](CHANGELOG.md).

## Contact

Questions about privacy: open an issue on this repository.
