# Changelog

## Unreleased

- The Server Dashboard is themed too: pick a theme in **Settings > Display > Server Dashboard theme**. The new
  `dashboard-base.css` recolours Jellyfin's MUI palette and gives the admin pages the theme's panels, fields,
  buttons, tables and side drawer. The server Custom CSS doesn't load on the Dashboard, so it builds only on each
  theme's own values.
- Themed screensavers: `screensavers.js` adds ten animated screensavers, one per theme, plus "match my theme",
  to Settings > Display > Screensaver. Each is built from random movies and shows in your library.
- Cyberpunk's decrypt effect now also runs on side-drawer items, in the Dashboard and the main app.

## 1.0.0, 27 October 2026

First public release, for Jellyfin 12.2.

- Ten themes: Neon Arcade, Phosphor, Cosmos, Blueprint, Lava Lamp, Cyberpunk, Desktop 95, Mission HUD, Sakura,
  Thermal Vision.
- Each one themes the pages and cards, the My Media tiles, the loading animation, the title hover effects, the
  video player and its Up Next card, subtitles, settings forms, search and menus, card badges and progress bars,
  the cast row, the Live TV Guide and scrollbars.
- Optional `effects.js` for per-theme animations.
- The server Custom CSS (`custom-css/aurora-glass.css`) the themes build on, including a fix for collapsed cast
  photos on detail pages.
- Fixes found by a layout audit of 16 pages in every theme: the detail page's Video / Audio / Subtitles labels no
  longer print their word over ElegantFin's icons, and round cast photos drop Cyberpunk's rectangular cut-corner
  frame.
- Privacy policy, security policy and contributing guide.
