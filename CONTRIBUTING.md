# Contributing

Thanks for helping. Bug reports, fixes for new Jellyfin versions and new themes are all welcome.

## Reporting a problem

Open an issue with:

- the theme, your Jellyfin version and your browser
- the page and what looks wrong, with a screenshot if you can
- whether it still happens after a hard refresh (Ctrl+Shift+R)

**Before you attach a screenshot,** crop or blur your server name, user names, IP addresses and anything else
personal.

## Changing a theme

- Shared layout belongs in the `*-base.css` files. A theme's own `theme.css` should mostly set custom properties
  (`--hp-*`, `--pl-*`, `--fm-*`, `--ex-*`) and add its decorations.
- Follow the existing pattern: rules start with `html:root` so they outrank Jellyfin's and the Custom CSS's, and
  custom properties are set on `html:root:root`.
- A change to a shared file affects all ten themes: check each one.
- Animations need a `prefers-reduced-motion` fallback.
- Check the page in at least one narrow (phone) and one wide window.

## Adding a theme

1. Copy the theme folder closest to what you want and rename it.
2. Change its palette and decorations, and draw its six tiles (960×540 JPEG).
3. Add its `config.json` entry to the README, a row to the gallery, and a swatch in `assets/swatches/`.

## Pull requests

- One topic per pull request, with a short description and before/after screenshots.
- No personal data in commits, code, screenshots or test files: use documentation addresses (`192.0.2.x`,
  `2001:db8::`) and placeholder names.
- By contributing you agree that your work is released under the [MIT License](LICENSE).
