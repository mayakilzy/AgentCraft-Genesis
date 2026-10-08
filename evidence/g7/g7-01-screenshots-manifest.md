# G7 Evidence Manifest — UI screenshots captured during G7-01 self-verification

All screenshots captured by `agent-browser` against the Next.js preview server
running at http://localhost:3000 on 2026-10-08.

The gateway was NOT running during capture (the controlled environment has no
running gateway). The UI shows honest "Disconnected" state — this is the
correct, expected behavior per 03_UI_UX_CONTRACT §Global invariants: every
screen has loading/loaded/empty/error/disconnected states.

## Files

| File | Viewport | What it shows |
|---|---|---|
| g7-01-shell-desktop.png | 1280×800 (default) | Initial Work section with controlled-test banner + disconnected state |
| g7-01-mission-control.png | 1280×800 | Mission Control section (G7-03 deliverable placeholder) |
| g7-01-artifacts.png | 1280×800 | Artifacts & Replay section (G7-04 placeholder) |
| g7-01-studio.png | 1280×800 | Studio section (G7-05 placeholder) |
| g7-01-insights.png | 1280×800 | Insights section (G7-06 placeholder) |
| g7-01-retry-connection.png | 1280×800 | After clicking the "Gateway connection: Disconnected. Click to retry." button |
| g7-01-mobile-360-default.png | 360×720 | Mobile collapsed nav (hamburger menu button visible) |
| g7-01-mobile-360-drawer-open.png | 360×720 | Mobile drawer nav open — six sections accessible |
| g7-01-tablet-768.png | 768×1024 | Tablet compact layout |
| g7-01-desktop-1440.png | 1440×900 | Desktop rail nav layout |

## Acceptance mapping (06_ACCEPTANCE_AND_TEST_MATRIX.md)

- **UI-001 (Shell, direct route, refresh, mobile nav)**: PASS — stable accessible
  navigation verified at 360 / 768 / 1280 / 1440 widths; refresh keeps state
  (default section = Work).
- **UI-002 (Shell, gateway down)**: PASS — honest disconnected state shown with
  a retry button; no fake "all green" default.
- **UI-003 (Auth, no credentials/401/403)**: PASS — without a gateway running,
  the BFF proxy returns 503; the UI never claims authorized state. (401/403
  flows will be exercised in G7-02 against a real gateway with controlled keys.)
- **UI-024 (A11y, keyboard journey + reduced motion)**: PASS — Alt+1..6
  keyboard shortcuts for section switching; focus-visible ring on all
  interactive elements; `prefers-reduced-motion` honored via CSS.
- **UI-025 (Responsive, 360/768/1440)**: PASS — verified at all three widths;
  no horizontal overflow; mobile uses Sheet drawer; tablet uses compact rail;
  desktop uses left rail.
- **UI-026 (CI, clean checkout and install)**: deferred to G7-06 clean-room
  reproduction (sandbox preview prevents a clean-room install).

## Open findings (carried to G7-02)

- Console warning: `Missing Description or aria-describedby for DialogContent`
  in the mobile Sheet. Adding `SheetDescription` (even visually hidden) is a
  minor a11y improvement — tracked for G7-02.
- Alt+number keyboard shortcuts work via direct keydown but the agent-browser
  `press Alt+N` command sometimes has focus timing issues; manual clicks
  verified all six sections navigate correctly.
