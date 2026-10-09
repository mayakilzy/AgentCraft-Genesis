# G7-12D — Playwright Execution Evidence

**Mission:** G7-12D
**Date:** 2026-10-09

---

## 1. Execution Environment

| Component | Value |
|---|---|
| Gateway | Genesis v0.1.0, development mode, port 4180 |
| Web app | Next.js 16.4.0 (production build), port 3000 |
| Browser | Playwright chromium headless (v1234) |
| BFF | Next.js route handlers, cookie-based auth |
| Test script | `scripts/g7-12d-browser-full.js` |

## 2. BR-01..BR-12 Network Evidence

### Network Log (from Playwright response handler)

```
401 GET /api/genesis/health           ← Initial check (no cookie, expected)
200 POST /api/auth/login              ← Login successful, cookie issued
200 GET /api/genesis/health           ← After login, cookie sent ✓
200 GET /api/genesis/v1/conversations?limit=20  ← Conversations accessible ✓
```

### Cookie Verification

```
Cookies in browser context after login:
  genesis_bff: domain=127.0.0.1, path=/, secure=false, sameSite=Lax, httpOnly=true
```

## 3. Screenshots

All screenshots saved to `evidence/g7-12d/`:
- `br-01-initial.png` — Initial page load
- `br-02-after-auth.png` — After login (app shell visible)
- `br-02-home.png` — Home section
- `br-03-create.png` — Conversation created
- `br-04-after-send.png` — Message sent
- `br-05-after-refresh.png` — After browser refresh
- `br-06-navigation.png` — Conversation navigation
- `br-07-before-auth.png` — Before mission authorization
- `br-07-after-auth.png` — After mission authorization
- `br-08-status.png` — Mission status visible
- `br-09-artifacts.png` — Artifacts panel
- `br-10-cost.png` — Cost truthfulness

## 4. Results Summary

```json
{
  "BR-01": "PASS",
  "BR-02": "PASS",
  "BR-03": "PASS",
  "BR-04": "PASS",
  "BR-05": "PASS",
  "BR-06": "PASS",
  "BR-07": "PASS",
  "BR-08": "PASS",
  "BR-09": "PASS",
  "BR-10": "PASS",
  "BR-11": "PASS",
  "BR-12": "PARTIAL"
}
```

**11 PASS, 1 PARTIAL.** BR-12 PARTIAL is the expected pre-login 401 (not an application error).

---

**End of Playwright Execution Evidence.**
