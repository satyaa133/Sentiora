# Sentiora redesign: design handoff

This file is the single source of truth for the Sentiora UI/UX redesign.
It covers the web app (`frontend/`), the Chrome extension popup (`extension/`) and shared UI (`shared/`).
Reference screenshots live in `docs/design/` (exported from the design canvas).

Do not change backend APIs, auth logic, data fetching, routes or capture logic. This is a visual and UX rewrite only.

---

## 1. Brand

- **Name:** sentiora (lowercase in the wordmark)
- **Promise:** "Remember everything you read." Sentiora saves the articles, PDFs and videos you choose, then answers questions from them with sources.
- **Tone:** calm, plain, short sentences. No hype, no exclamation marks, no emoji in UI.
- **Mascot:** Echo, a friendly ghost (see section 4).

## 2. Color tokens (Graphite & Coral, light + dark)

Implement as CSS variables in a shared stylesheet, consumed by Tailwind. Theme follows the OS (`prefers-color-scheme`) with a manual override via `data-theme="light" | "dark"` on `<html>`, persisted in localStorage (wrap in try/catch).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F4F4F3` | `#111111` | Page background |
| `--surface` | `#FFFFFF` | `#1A1A1A` | Cards, panels, popup |
| `--surface-raised` | `#EBEBE8` | `#1F1F1F` | Highlight sections, secondary buttons |
| `--text` | `#111111` | `#F4F4F3` | Body text, Echo body |
| `--text-muted` | `#5F5F5C` | `#A8A8A4` | Secondary text |
| `--border` | `#E5E5E2` | `#2A2A2A` | Borders, dividers |
| `--border-soft` | `#F0F0EE` | `#222222` | List separators |
| `--accent` | `#FF5A3C` | `#FF5A3C` | Primary buttons, icons, highlights |
| `--accent-hover` | `#E0472B` | `#E0472B` | Button hover |
| `--on-accent` | `#111111` | `#111111` | Text on coral (never white) |
| `--link` | `#C93520` | `#FF5A3C` | Links and coral-colored text |
| `--accent-soft` | `#FFE3DD` | `#3B2420` | Tags, selected nav item background |
| `--accent-soft-text` | `#A12A18` | `#FF8A73` | Text on accent-soft |

Source-type badges (keep distinct in both modes):
WEB `#FFE3DD / #A12A18`, PDF `#FDF0D9 / #7A4B00`, VIDEO `#FBE4E1 / #8A2A1E`, NOTE `#E6F2D0 / #3D5410`.

Accessibility rules:
- Coral `#FF5A3C` is never used as text on light backgrounds (3.1:1). Use `--link` instead.
- Text on coral is always `#111111`.
- Body text ≥ 15px, never the 11–12px used today. Touch targets ≥ 44px.
- Visible focus ring: `2px solid var(--accent)` with 2px offset.

## 3. Typography

San Francisco on Apple devices, Inter everywhere else. Load Inter from Google Fonts (`Inter:opsz,wght@14..32,400..800`) in `frontend/index.html` and `extension/src/popup/index.html`.

```ts
fontFamily: {
  sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Inter", "sans-serif"],
  display: ["-apple-system", "BlinkMacSystemFont", "SF Pro Display", "Inter", "sans-serif"],
  mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
}
```

| Role | Size / weight | Notes |
|---|---|---|
| Hero headline | clamp(48px, 6vw, 84px) / 750 | letter-spacing -0.035em, line-height 0.98 |
| Section heading | clamp(36px, 4vw, 56px) / 700 | letter-spacing -0.03em |
| Page title (app) | 36px / 700 | |
| Card title | 16–18px / 600 | |
| Body | 16–18px / 400 | line-height 1.55 |
| Labels, dates, shortcuts | 12–13px mono, uppercase for eyebrows | letter-spacing 0.06em |

Radii: buttons 12–14px, cards 18–24px, chips 999px. Shadows: soft and rare (`0 30px 60px -30px rgba(17,17,17,0.25)` for floating product shots only).

## 4. Echo (mascot)

Create `shared/src/components/Echo.tsx` (or a local copy in each app if shared React components are not set up) used by both web and extension.

Props: `state: "idle" | "saving" | "happy" | "faded" | "guarding"`, `size: number`, `title?: string` (if absent, `aria-hidden`).

Base shape (viewBox `0 0 120 120`): body path
`M30 60 C30 22 90 22 90 60 V100 L80 92 L70 100 L60 92 L50 100 L40 92 L30 100 Z`
filled `var(--text)`, eyes filled `var(--surface)`, cheeks `#FF5A3C` circles at (42,68) and (78,68) r=4.

| State | Eyes / details | Where |
|---|---|---|
| idle | Ovals at (50,56) and (70,56), rx5 ry7 | Popup ready state, resurfaced card |
| saving | Body raised 8px, round eyes, small "o" mouth, dashed coral line under | While capture is in progress |
| happy | Arc eyes, smile | After save, next to AI answers |
| faded | Body at 35% opacity, closed eyes, "z z" | Empty states, no results |
| guarding | Small eyes, coral shield with dark check in front | Blocked / sensitive pages |

Logo mark: simplified ghost (body + eyes, no cheeks) next to the wordmark "sentiora". Extension icon: ghost on a coral rounded square (16, 32, 48, 128 px).

Motion: Echo bobs 4px on a 3s ease-in-out loop when idle; quick upward float on save. Respect `prefers-reduced-motion`.

## 5. Screens

### 5.1 Landing page (`frontend/src/pages/LandingPage.tsx`)
Remove: dark gradient hero, blurred glow blobs, orbit rings, floating emoji chips, fake "247+ memories" stat, identical feature cards.

Sections, in order:
1. **Sticky nav**: logo + wordmark · How it works · Ask · Privacy · FAQ · Log in · "Add to Chrome" (graphite button in light, coral in dark).
2. **Hero** (two columns, stacks on mobile): pill "A private memory for everything you read"; H1 "Remember everything you read."; sub "Sentiora saves the articles, PDFs and videos you choose, then answers your questions from them, with the sources linked."; buttons "Add to Chrome, it's free" (coral) and "See how it works"; small line "Saves only when you click. Skips banking and health pages on its own." Right: browser-window mockup of an article with the extension icon highlighted, and a floating "Saved to your memory" card with happy Echo and tags.
3. **"Saves from" strip**: Web articles · PDFs & papers · YouTube transcripts · Your own notes · Uploaded files.
4. **How it works** (sticky scroll: steps swap as you scroll on desktop, stacked cards on mobile): 01 Save with one click (Alt+Shift+S keycaps) · 02 Search by meaning (search box finding the right page) · 03 Ask, with sources (Q&A bubble with citation chip).
5. **Ask band**: "Ask your own library, not the whole internet." with a chat card showing a question, an answer with numbered citations, and the source list.
6. **Privacy**: guarding Echo + three points: Nothing saves until you click · Sensitive pages are skipped · Export or delete anytime.
7. **FAQ**: native `<details>` accordion, 4 questions. Leave answers as `[TODO]` where unknown, do not invent pricing.
8. **Final CTA**: happy Echo, "Give your reading a memory.", "Add to Chrome".
9. **Footer**: wordmark, Privacy, Terms, GitHub, Contact.

No invented stats, testimonials or logos.

### 5.2 Chrome extension popup (`extension/src/popup/App.tsx`, 360px wide)
Three states, keep all existing capture/auth logic:
1. **Ready**: header (logo, settings icon button), page card (type · read time · domain, title), optional note input, primary button "Save to memory" with shortcut hint, "Recently saved" list (2 items) + "Open Sentiora →".
2. **Saved**: dark header area with happy Echo, "Saved. Echo's got it.", "Searchable in a few seconds", title, editable tags, "Undo" + "Open in Sentiora".
3. **Protected page** (from `sensitiveGuard` / blocklist): guarding Echo, "Echo won't save this page", reason sentence, domain chip with "Built-in rule" / "Your rule", "Review blocked sites", "Why was this blocked?".
Also: error state using faded Echo with a retry button; logged-out state restyled (`PopupAuth.tsx`).

### 5.3 App shell (`frontend/src/components/Sidebar.tsx`)
Sidebar items: Home, Timeline, Ask Sentiora, Sources, Privacy; user block at bottom with Settings link. Active item uses `--accent-soft`. Collapses to a top bar on mobile. Search moves into the home page and a global Ctrl/Cmd+K palette.

### 5.4 Home (`frontend/src/pages/DashboardHome.tsx`)
Greeting ("Good evening, {name}") + "Add memory" button; large search/ask input with Ctrl K hint; "Resurfaced" card (idle Echo, "saved N weeks ago", Revisit / Not now); "Recent memories" list with filter chips (All, Web, PDF, Video, Notes) and source badges; right column "Try asking" suggestions linking to Ask, and a "This week" mini bar chart (real data only).

### 5.5 Ask Sentiora (`frontend/src/components/views/AskSentioraView.tsx`)
Narrow icon rail, conversation centered (max 780px), user bubbles graphite (light) / raised (dark), answers with happy Echo avatar and numbered citation chips, action buttons (Copy, Save as note), composer pinned at bottom with "Answers only use your saved memories." Right panel "Sources used": cards with number, type, date, quoted snippet, "Open memory" / "Jump to 14:20" for video. When the answer isn't in memory, say so plainly.

### 5.6 Onboarding (`frontend/src/pages/Onboarding.tsx`)
Split layout: left graphite panel with waving Echo and a 3-step progress list; right: "Step 2 of 3 · What should Echo remember?" with selectable source cards (checkbox inside a label), privacy note, Back / Continue.

### 5.7 Remaining views (same components, no mockup)
Timeline, Search, Connected Sources, Privacy Center, Account Settings, Login, Sign up, Forgot password, Memory detail drawer, Add memory modal, skeletons. Apply the tokens, type scale and components; use faded Echo for empty states and guarding Echo in Privacy Center.

## 6. Components to build first
Button (primary / secondary / ghost / icon), Input + Label, Textarea, Chip / Tag, SourceBadge, Card, MemoryRow, Toggle, Modal, Drawer, Tabs, Toast, Skeleton, Echo, Logo, ThemeToggle.

## 7. Rules
- Replace all emoji icons with inline stroke SVG icons (Lucide is fine).
- Use only tokens, never raw hex in components.
- Every page must work at 375px wide with no horizontal scroll.
- Keep all existing tests passing; update snapshot or text assertions that change.
- Real `<button>`, `<a>`, `<label>`; `aria-label` on icon-only buttons.
- Motion: 150–250ms, one easing curve, respect reduced motion.
