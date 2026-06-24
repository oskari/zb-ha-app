# Third-Party Notices

ZerryBit Engine is distributed under the MIT License (see [LICENSE](LICENSE)).
It depends on third-party open-source components that are distributed under
their own licenses. The notices below cover the components whose licenses
require attribution or distinguish themselves from the project's MIT terms.
A complete dependency list and its resolved licenses can be produced from the
lockfiles with a tool such as `npx license-checker`.

## Image processing

### libvips

- **Component:** libvips (bundled as the prebuilt `@img/sharp-libvips-*`
  platform packages that `sharp` loads at runtime).
- **License:** LGPL-3.0-or-later.
- **Source:** https://github.com/libvips/libvips
- **Notice:** libvips is licensed under the GNU Lesser General Public License,
  version 3 or later. ZerryBit Engine uses libvips as a dynamically-loaded
  prebuilt shared library via `sharp`; it does not statically link or modify
  libvips. The corresponding source is available at the URL above. A copy of
  the LGPL-3.0 is available at https://www.gnu.org/licenses/lgpl-3.0.html.

### sharp

- **Component:** sharp (Node.js binding for libvips).
- **License:** Apache-2.0.
- **Source:** https://github.com/lovell/sharp
- **Notice:** Copyright Lovell Fuller and contributors. Licensed under the
  Apache License, Version 2.0; a copy is available at
  https://www.apache.org/licenses/LICENSE-2.0.

### sharp prebuilt platform binaries (`@img/sharp-*`)

- **Component:** The `@img/sharp-<platform>` packages that `sharp` loads at
  runtime to provide the compiled binding for the host platform (e.g.
  `@img/sharp-linuxmusl-arm64`, `@img/sharp-linuxmusl-x64`). The libvips shared
  library these wrap is covered separately under **libvips** above.
- **License:** Apache-2.0.
- **Source:** https://github.com/lovell/sharp
- **Notice:** Copyright Lovell Fuller and contributors. Licensed under the
  Apache License, Version 2.0 (a copy is available at the URL in the sharp
  notice above).

### detect-libc

- **Component:** detect-libc (runtime dependency of `sharp`; detects whether the
  host uses glibc or musl so the correct prebuilt binary is selected).
- **License:** Apache-2.0.
- **Source:** https://github.com/lovell/detect-libc
- **Notice:** Copyright Lovell Fuller and contributors. Licensed under the
  Apache License, Version 2.0 (a copy is available at the URL in the sharp
  notice above).

## Fonts

### Sora

- **Component:** Sora (bundled under `fonts/latin/` as the pre-rasterized
  bitmap-glyph JSON files `Sora_*.json`).
- **License:** SIL Open Font License, Version 1.1 (OFL-1.1).
- **Source:** https://github.com/sora-xor/sora-font
- **Notice:** Copyright 2019 The Sora Project Authors
  (https://github.com/sora-xor/sora-font). The bundled `fonts/latin/Sora_*.json`
  files are a rasterized derivative (a fixed-size bitmap-glyph subset) of the
  Sora typeface. The upstream OFL does not declare a Reserved Font Name, so the
  derivative retains the "Sora" family name. A verbatim copy of the OFL-1.1,
  including the original copyright statement, is bundled at
  [fonts/OFL.txt](fonts/OFL.txt).

## Icons

### Tabler Icons

- **Component:** Tabler Icons (SVG path data extracted into
  `builder/src/data/tabler-icons.json` and bundled into the builder SPA shipped
  under `builder/dist/`).
- **License:** MIT.
- **Source:** https://github.com/tabler/tabler-icons
- **Notice:** Copyright (c) 2020-2026 Paweł Kuna.

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
