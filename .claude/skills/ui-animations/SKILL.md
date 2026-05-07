---
name: ui-animations
description: Apply Emil Kowalski's "good vs great" animation principles when adding or reviewing UI motion. Auto-invoke when the user asks to add animations, polish transitions, fix "feeling cheap" UI, make something feel "premium" / "wow", smooth out interactions, add stagger / springs, or review existing CSS transitions. Covers origin-aware transforms, easing curves, spring physics, property selection, and progressive enhancement.
allowed-tools: Read, Edit, Write, Bash, Grep
---

# UI Animations — Good vs Great

**Source:** https://emilkowal.ski/ui/good-vs-great-animations
**Project:** TradeContext.ai (trading dashboard — animation must be decorative, never obscure data)

This skill takes UI motion from "functional" to "feels expensive". When invoked, walk through the 5 principles in order, identify which apply to the current task, and apply them.

---

## Trigger phrases (auto-invoke)

- "add an animation" / "make it animated" / "animate this"
- "polish the transitions" / "smooth this out"
- "feels cheap" / "feels generic" / "feels mechanical"
- "make it premium" / "make it feel premium" / "wow factor"
- "stagger" / "spring physics" / "feels off"
- "review my transitions" / "audit animations"

## Hard rule for trading dashboards

**Never animate live data values** (prices, P&L, position sizes, stop levels). Spring-interpolated price ticks misrepresent the actual market and could mislead a trader. Animate **chrome only**: hover states, panel reveals, modal entrance/exit, toast slide-ins, breaking-news pulses, decorative widgets like the world map or risk thermometer.

---

## The 5 principles

### 1️⃣ Origin-aware animations

**Why:** Animations from nowhere feel disorienting. Anchoring them to their source creates visual continuity.

**Apply to:** dropdowns, popovers, tooltips, context menus, modals triggered from a button.

```css
/* Bad — appears from center, no anchor */
.dropdown { transform: scale(0.95); }

/* Great — origin matches trigger position */
.dropdown {
  transform: scale(0.95);
  transform-origin: top right;  /* if triggered from a button in top-right */
}
```

**Radix / shadcn users:** `var(--radix-popover-content-transform-origin)` does this automatically.

**For dynamic origin** (e.g. JS-driven popups), capture mouse position on click and set `transform-origin: ${x}px ${y}px`.

---

### 2️⃣ Use the right easing (default `ease-out`)

> "Easing is the most important part of any animation. It can make a bad animation feel great and a great animation feel bad." — Emil Kowalski

**Default to `ease-out`** for most UI motion. It mimics how things slow down as they arrive — natural for elements appearing.

```css
/* Default — use this 80% of the time */
transition: opacity 200ms ease-out, transform 200ms ease-out;

/* Use ease-in for elements LEAVING the screen (gather speed as they go) */
.modal-exit { transition: opacity 150ms ease-in, transform 150ms ease-in; }

/* Avoid ease-in for entering elements — feels unnatural, lacks deceleration */
```

**`ease-in-out`** is good for symmetric motion (pendulum, breathing, bouncing) but feels mechanical for one-shot UI transitions.

---

### 3️⃣ Custom easing curves (when generic feels cheap)

Built-in CSS easing is fine for hover colour changes, not for "wow" moments. Use **custom cubic-bezier curves** for hero animations, modals, important transitions.

**Recommended curves** (steal these directly):

```css
:root {
  --ease-out-quart:    cubic-bezier(0.25, 1, 0.5, 1);      /* punchy, energetic */
  --ease-out-expo:     cubic-bezier(0.16, 1, 0.3, 1);      /* dramatic deceleration */
  --ease-out-back:     cubic-bezier(0.34, 1.56, 0.64, 1);  /* slight overshoot — playful */
  --ease-spring:       cubic-bezier(0.5, 1.4, 0.5, 1);     /* spring-like bounce */
  --ease-smooth:       cubic-bezier(0.4, 0, 0.2, 1);       /* Material Design standard */
}

/* Use them */
.modal-enter { transition: all 240ms var(--ease-out-expo); }
.button:hover { transition: transform 140ms var(--ease-out-quart); }
```

**Curve playgrounds:**
- https://easings.co
- https://easing.dev

---

### 4️⃣ Spring-based interactions (for cursor / scroll / drag)

**Why:** Direct mouse-coupled values feel mechanical. A spring lag of ~50-150ms gives motion a sense of mass.

**Use for:** cursor-following elements, drag handles, slide indicators, hover-tracked highlights, scroll-linked parallax.

**Vanilla JS spring (no Framer Motion needed):**

```js
function spring(target, config = { stiffness: 0.15, damping: 0.7 }) {
  let value = target.current;
  let velocity = 0;
  function step() {
    const force = (target.target - value) * config.stiffness;
    velocity = (velocity + force) * config.damping;
    value += velocity;
    target.onUpdate(value);
    if (Math.abs(velocity) > 0.01 || Math.abs(target.target - value) > 0.5) {
      requestAnimationFrame(step);
    }
  }
  step();
}
```

**With Framer Motion / Motion:** use the `useSpring` hook with `stiffness: 200, damping: 30` for snappy UI, `stiffness: 80, damping: 14` for bouncy.

**Hard rule:** never spring-animate trade prices, P&L, or order quantities. Springs are for **decorative** values (animated counters on the landing page, parallax, etc.).

---

### 5️⃣ Know your tools — pick the right CSS property

Multiple animations on the same element must move together. Picking the wrong property creates temporal misalignment ("feels off").

**Common mistakes & fixes:**

| Component | Bad approach | Great approach |
|-----------|--------------|---------------|
| Tab indicator (highlight bar + text colour change) | Animate `transform` on bar + `color` on text — text changes lag behind bar | Use `clip-path` on a single coloured layer so colour & position are inherently coupled |
| Modal scale-in | Animate `width` / `height` (causes reflow) | Animate `transform: scale()` (GPU-accelerated, no reflow) |
| Card hover lift | Animate `top` / `margin-top` | Animate `transform: translateY(-2px)` |
| Sliding panel | Animate `left: -100%` → `0%` | Animate `transform: translateX(-100%)` → `0` |

**Properties that animate cheaply (GPU-accelerated):**
- `transform` (translate / scale / rotate / skew)
- `opacity`
- `filter` (use sparingly — can be expensive)
- `clip-path` (for shape-coupled motion)

**Properties to avoid animating:**
- `width`, `height`, `padding`, `margin`, `top`, `left` — trigger layout reflow
- `box-shadow` directly — animate a pseudo-element's `opacity` instead

**Discovery technique:** Play the animation in **slow motion** (set `transition-duration: 2000ms` temporarily). If anything looks staggered, misaligned, or weird — that's where to fix it.

---

## How to apply this skill (workflow)

When invoked, do these steps in order:

1. **Identify the target.** Ask the user what element/component they want animated, OR if they ask for a sweep, grep for existing `transition`, `animation`, `@keyframes` rules.

2. **Audit existing animations** if present:
   - Are they origin-aware? (transform-origin set?)
   - Easing — `ease-out` for entrances, `ease-in` for exits, custom for hero moments?
   - Property choice — using `transform`/`opacity` (good) vs `width`/`top` (bad)?
   - Spring needed (cursor-following) vs not (one-shot)?

3. **Suggest minimal upgrades.** Don't rewrite — patch. Common one-liner wins:
   - Replace `linear` / `ease-in-out` with `ease-out` for entrances
   - Add `transform-origin` to popovers/dropdowns
   - Promote `--ease-out-expo` cubic-bezier var to all primary transitions
   - Replace `animation: name 0.3s` with `animation: name 0.3s cubic-bezier(...)` 

4. **Add the easing variables** to `:root` if not present.

5. **Test in slow motion.** Bump duration 5x, eyeball, restore.

6. **Show the user what changed** — list each replacement so they can sanity-check.

---

## Quick wins for TradeContext.ai (project-specific)

These are common dashboard upgrades — check if any are still missing:

- ✅ Toast slide-ins use `cubic-bezier(.16,1,.3,1)` ease-out-expo (already done)
- ✅ Modal opens use `transform-origin: center top` (matches the search button location)
- ✅ KPI numbers fade in with `countUp` animation, not animated digits (correct — we don't spring trade data)
- ✅ Breaking news red-glow uses `breakingGlow 2.8s ease-in-out infinite` (rhythmic = appropriate)
- ✅ World Map auroraSweep + continentShimmer use `linear infinite` (correct for ambient motion)
- 🔍 **Audit candidates:**
  - Symbol modal `.modal-bg.open` → currently `display:flex` on toggle, no scale-in. Add `transform-origin: top` + `scale(0.97)→1` with `cubic-bezier(.16,1,.3,1)` 200ms.
  - News card hover lift → currently no transform; add `translateY(-1px)` on hover with `var(--ease-out-quart)`.
  - Trade panel buttons (Buy/Sell) → on `:active`, scale to 0.97 with 80ms ease-out for press feedback.

---

## References

- **Source article:** https://emilkowal.ski/ui/good-vs-great-animations
- Easing curve generators: https://easings.co · https://easing.dev
- Emil's other UI articles: https://emilkowal.ski/ui
- Motion (Framer Motion successor): https://motion.dev
