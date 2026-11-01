# Sentiora redesign: design handoff

This file is the single source of truth for the Sentiora UI/UX redesign.
It covers the web app (`frontend/`), the Chrome extension popup (`extension/`) and shared UI (`shared/`).
Reference screenshots live in `docs/design/` (exported from the design canvas). The interactive reference is `docs/design/preview/sentiora-preview.html`: open it in a browser. It is a throwaway prototype for behavior and feel, not code to copy as-is. Where this spec and the preview disagree, this spec wins.

Do not change backend APIs, auth logic, data fetching, routes or capture logic. This is a visual and UX rewrite only.

---

## 1. Brand

- **Name:** sentiora (lowercase in the wordmark)
- **Promise:** "Remember everything you read." Sentiora saves the articles, PDFs and videos you read (automatically while signed in, skipping sensitive pages), then answers questions from them with sources.
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
2. **Hero**: see section 9.1 (replaces the earlier browser-mockup hero).
3. **"Saves from" strip**: Web articles · PDFs & papers · YouTube transcripts · Your own notes · Uploaded files.
4. **Before/after** (9.2), then **How it works scroll story** (9.3), then **Extension clip** (9.4).
5. **Ask band**: "Ask your own library, not the whole internet." with a chat card showing a question, an answer with numbered citations, and the source list.
6. **Privacy**: guarding Echo + three points: You stay in control (saving runs only while signed in; block any site, delete anything) · Sensitive pages are skipped · Export or delete anytime. Followed by the privacy flow diagram (9.5).
7. **FAQ**: native `<details>` accordion, 4 questions. Leave answers as `[TODO]` where unknown, do not invent pricing.
8. **Final CTA**: happy Echo, "Give your reading a memory.", "Add to Chrome".
9. **Footer**: wordmark, Privacy, Terms, GitHub, Contact.

No invented stats, testimonials or logos.

### 5.2 Chrome extension popup (`extension/src/popup/App.tsx`, 360px wide)
Three states, keep all existing capture/auth logic:
1. **Ready / status**: header (logo, settings icon button), page card (type · read time · domain, title) showing the current page status (Saved / Saving… / Blocked), since saving is automatic; optional note input; "Recently saved" list (2 items, existing GET) + "Open Sentiora →".
2. **Saved**: dark header area with happy Echo, "Saved. Echo's got it.", "Searchable in a few seconds", title, editable tags, "Undo" + "Open in Sentiora".
3. **Protected page** (from `sensitiveGuard` / blocklist): guarding Echo, "Echo won't save this page", reason sentence, domain chip with "Built-in rule" / "Your rule", "Review blocked sites", "Why was this blocked?".
Also: error state using faded Echo with a retry button; logged-out state restyled (`PopupAuth.tsx`).

### 5.3 App shell (`frontend/src/components/Sidebar.tsx`)
Sidebar items: Home, Timeline, Ask Sentiora, Sources, Privacy; user block at bottom with Settings link. Active item uses `--accent-soft`. Collapses to a top bar on mobile. Search moves into the home page and a global Ctrl/Cmd+K palette.

### 5.4 Home (`frontend/src/pages/DashboardHome.tsx`)
Greeting ("Good evening, {name}") + "Add memory" button; large search/ask input with Ctrl K hint; "Resurfaced" card (idle Echo, "saved N weeks ago", Revisit / Not now); "Recent memories" list with filter chips (All, Web, PDF, Video, Notes) and source badges; right column "Try asking" suggestions linking to Ask, and a "This week" mini bar chart (real data only).

### 5.5 Ask Sentiora (`frontend/src/components/views/AskSentioraView.tsx`)
Narrow icon rail, conversation centered (max 780px), user bubbles graphite (light) / raised (dark), answers with happy Echo avatar and numbered citation chips, action buttons (Copy, Save as note), composer pinned at bottom with "Answers only use your saved memories." Right panel "Sources used": cards with number, type, date, quoted snippet, "Open memory" / "Jump to 14:20" for video. When the answer isn't in memory, say so plainly.

**RAG v2 update (docs/RAG_v2_ADDENDUM.md, R7):** left History sidebar (conversations kept in this browser; a drawer on phones). Answers stream in with a typing skeleton, a Stop button, and Regenerate. Citations are coral `[S#]` chips inline in the text: hover or focus previews the excerpt, click opens the source (videos at the cited time). The right "Sources used" panel is replaced by a collapsible "Sources used" panel under each answer (same cards). One small mode badge (From your memory / General knowledge / Mixed) replaces separate memory and general sections. Follow-up chips come from the model. A "Search in" picker scopes answers to all memories, a source type, or one memory. When nothing relevant is saved: faded Echo and "Nothing relevant saved yet". Keys: Enter sends, Shift+Enter adds a line, Ctrl/Cmd+K focuses the composer on this page, Esc stops.

### 5.6 Onboarding (`frontend/src/pages/Onboarding.tsx`)
Split layout: left graphite panel with happy Echo and a progress list showing all 4 existing steps; right: "What should Echo remember?" (copy must say Echo saves the pages you read and you can block sites in Privacy) with selectable source cards (checkbox inside a label), privacy note, Back / Continue.

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

---

# Additions (v2): landing experience, Echo behavior, extras

## 8. Echo behavior (two modes)

One `EchoCompanion` component, mounted once at the app root, with a `mode` prop driven by the route.

### 8.1 Roaming mode: landing page only (`/`)
- Echo (96px, 64px on screens under 720px) floats freely over the page with steering movement: accelerates toward a target, eases in, tilts toward its direction, flips horizontally, gentle 4px bob. Little arms swing with speed.
- **Memories:** small coral page-scraps (with a label: article, PDF, video, note, paper…) pop out of real headings and paragraphs every ~2s while fewer than 7 are visible. Echo chases the nearest visible one with a Pac-style chomping mouth, eats it (+1 pop, counter in nav "Echo saved N" increments).
- When nothing is left it wanders to a new random point every ~3.5s. Never stays still for long.
- **Interactions:**
  - **Click / Enter:** tickle; squish, happy eyes, short line ("hehe!").
  - **Drag:** carry it; "wheee" on release.
  - **Double-click on empty space:** drop a memory.
  - **Fast swipe near it:** scared; turns translucent, flees, says "eek!".
  - **Hover a primary button:** flies over and points ("click this one").
  - **Idle 40s+:** short 5s power-nap with "z z", wakes by itself.
  - **Occasional spin trick.**
- Eyes follow the cursor and blink every ~4s.
- Echo must never sit on top of the main hero CTA for more than a moment: exclude a padded rectangle around the hero buttons from targets.
- Speech bubble: short lines only, 1–2s.

### 8.2 Corner mode: every logged-in page (`/app/*`), extension never
- On entering the app Echo flies to the bottom-right corner (76px), above the controls, then **locks in place**: no roaming, no dragging, no bouncing, no memories on screen, double-click does nothing. Bob reduced to 1.5px.
- A small counter under Echo shows the user's total memories (from `useMemoryStats`), flashing coral on change.
- Echo shows faces and reacts **in place** using the states below. Messages are short and appear in a bubble to the left of Echo.

| Event (real app source) | Echo state | Bubble |
|---|---|---|
| New memory saved (feed refresh / capture event) | chomp → happy, counter +1 | "+1 {title}" |
| Page skipped by sensitive guard | guarding (shield) | "Skipped a banking page" |
| Typing in search | searching (magnifier moving) | "Found N matches" after results |
| Ask submitted / answer ready | thinking (thought dots) → happy | "Answer ready, with sources" |
| Resurfaced: Revisit / Not now | love (heart) / reading (book) | short line |
| Sidebar: Timeline / Ask / Sources / Privacy | reading / thinking / searching / guarding | short line |
| Idle 20s | sleeping (faded, "z z") until any input or event | none |
| Every ~4.5s while idle | random face (happy, love, think, read, giggle, look around) | none |
| Click Echo | tiny tick sound, a tip ("press Ctrl K to search") | tip |

- Only events that really exist in the app may trigger reactions. No fake events in production (the preview's timed demo saves are for demo only).

### 8.3 States and art
Use the ghost from section 4 with arms (two rounded strokes), plus props: magnifier, open book, heart, coral shield with check, thought dots, "z z". Mouth shapes: smile, open, chomp (Pac-style), o, flat, giggle. See `docs/design/echo/` PNG/GIF pack and the preview.

### 8.4 Sound (off by default)
- A "Sound off/on" toggle sits in a small control group bottom-right with "Pause Echo / Wake Echo". Remember both choices in localStorage (try/catch).
- All sounds are generated with Web Audio (no files): soft sine/triangle tones, master gain ~0.7 with individual sounds at 0.03–0.3. Turning sound on plays a quiet two-note chime.
- **Landing:** short babble (one blip per letter, max 7 letters) for speech bubbles, plus soft chomp, giggle, "wheee", scared, wake, pop.
- **App (corner mode):** no babble. Only a tiny tick on new saves and clicks.
- Nothing plays before the user turns sound on.

### 8.5 Accessibility
- Echo is decorative: `aria-hidden` on the roaming layer, except a focusable "Pause Echo" control. The corner counter has a text label.
- `prefers-reduced-motion`: Echo still moves but ~40% slower, no sparkle trail, no spin, no bob, no word-swap animation, no floating cards.
- Pause Echo stops all Echo motion and sound.

## 9. Landing page sections (new)

### 9.1 Hero
- Faint dot-grid background behind the right column, masked to fade out (no gradients or blobs).
- H1 "Remember everything you **read**." The last word swaps every 2.6s: read → watch → study → skim → bookmark, with a coral underline that draws in.
- Sub: "Sentiora saves the articles, PDFs and videos you read, then answers your questions from them, with the sources linked."
- Buttons: "Add to Chrome" (coral, store link [TODO]) and "See how it works".
- Trust row (3 dot items): Saves automatically while signed in · Skips banking, health and login pages · Export or delete anytime.
- **Right column: live demo card** "Try it · sample library":
  - Audience tabs: **Students (default) / Developers / Researchers**, each with its own 10-item sample library and 4 prepared Q&As.
  - Question input + Ask button, suggestion chips, answer area with Echo avatar.
  - Answer types out, then citation chips appear; matching library items light up; source cards (number, title, type, date) slide in.
  - Unknown questions get: "Nothing in this sample library covers that. In your own Sentiora, Echo searches everything you've saved."
  - **Autoplay:** while untouched for 12s (first run after ~1.5s) it types and answers its own questions in a loop.
  - All answers are prepared static data. **No API calls from the landing page.**
- Three floating "saved item" cards (VID / PDF / WEB) around the demo with slight mouse parallax; after an answer one flies into the library. Hidden under 860px.

### 9.2 Before / after ("Where did I read that?")
Two panels: **Without Sentiora** (dashed, muted: a row of tiny jiggling tabs, bookmark folders with counts, a search with "0 results in bookmarks") vs **With Sentiora** (the same query finding the right page with quote and "Found it in 0.4s" with Echo). Stacks on mobile.

### 9.3 How it works: scroll story
- Section ~340vh tall with a sticky inner layout: 4 beats on the left (You read like normal → It becomes a memory → Find it by meaning → Ask, with sources), one stage on the right that cross-fades between 4 scenes.
- Active beat highlighted with a coral bar; clicking a beat scrolls to it. The roaming Echo reacts per beat (point, chomp, search, happy).
- Under 860px or with reduced motion: no sticky; beats and scenes simply stack.

### 9.4 Extension clip ("Watch it save a real page.")
- Animated Chrome mock: 4 tabs (article, YouTube, local PDF, bank login), moving cursor that clicks tabs, extension icon with a counter badge (41 → 44).
- Each tab: icon pulses, a toast stacks bottom-right ("Saved: …", "Saved transcript: …", "Saved: OS notes…"); bank tab turns the icon green with a shield and toast "Skipped: banking page". Echo chomps on saves.
- 4.2s per step, loops, only runs while on screen.
- **Replace later** with a real 10–15s MP4/WebM screen recording (`autoplay muted loop playsinline`, poster image, paused under reduced motion). Keep the animated version as fallback until then.

### 9.5 Privacy flow diagram
"What happens to a page you visit": 1 You open a page (while signed in) → 2 Privacy check (banking, health, login pages and your blocklist) → Skipped (nothing is sent anywhere) / Saved (clean text, title and link only) → 3 Your private vault (only you can search it · export as JSON · delete anytime).
**Verify** that skipped pages are detected in the content script before any network call; if not, change the copy.

### 9.6 Header
Sticky. Nav: How it works · Extension · Ask · Privacy · FAQ. Right: "Echo saved N" chip (landing only), theme toggle, Log in, Add to Chrome. The Add to Chrome button switches from graphite to coral after scrolling past the hero.

### 9.7 Final landing order
Header → Hero → Saves-from strip → Before/after → How it works (scroll story) → Extension clip → Ask band → Privacy + flow diagram → FAQ → Final CTA → Footer.

## 10. Extra pages and details
- **404 page:** large Echo searching with a moving magnifier, "404", "Echo couldn't find this page.", buttons to home and dashboard. Echo roams here too.
- **Easter eggs (landing only):** Konami code makes Echo spin ("dance party!"); typing "boo" makes Echo jump ("hey, that's MY line!"); clicking Echo 7 times quickly shows a heart ("ok ok, you found my secret").
- **Favicon / link preview:** Echo mark on coral; OG image 1200×630 with Echo + headline.

## 11. Performance rules
- Landing must load fast on a mid-range phone (aim < 2.5s LCP). Echo, demo and story are plain React + CSS + requestAnimationFrame: no animation libraries unless already in the repo.
- Animations pause when the tab is hidden or the section is off screen.
- Sound and Echo code load lazily after first paint.

## 12. Later (not in this redesign, note in TASKS.md)
"Try it on any link" in the hero (needs backend fetch), Memory year-in-review card, shareable answer cards, pause-saving toggle in the popup ("pause on this site / for 1 hour"), Chrome Web Store listing assets, Product Hunt launch.

## 13. Logo: the dot in the i (replaces the ghost + wordmark logo)
- Wordmark "sentiora" in the display font, weight 800, letter-spacing -0.045em. The "i" is a dotless ı with a **coral circle** (`--accent`, about 0.3em) as its dot. The ghost no longer appears in the logo; Echo stays the mascot everywhere else.
- Used in the landing header, footer, app sidebar and extension popup header. Each letter is its own span so it can animate; give the whole mark `role="img" aria-label="sentiora"`.
- **Wave:** about 1.2s after load and then every 10s, the letters hop up one after another (60ms apart, 0.7s springy ease), and the coral dot hops higher with a small squash. It also waves on hover. No wave under reduced motion, and only while the mark is visible.
- Favicon / extension icon: the coral dot alone, or the dotless ı with the coral dot, on graphite.
- Dot states (optional, for later): pulses while saving, becomes a check when saved, becomes a lock on protected pages.
