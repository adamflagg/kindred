# UI Uplift

Making Kindred look and feel current, one surface at a time, **without spending performance or adding dependencies to do it**. Started 2026-09-30 with the program landing page.

This doc holds three things: the **ground rules** every uplift follows, the **house effects** already built and how to reuse them, and a **decision log** recording what was mocked, what was chosen, and why. Add to the log each time a surface is uplifted; when a rule turns out wrong, change the rule here rather than working around it in one place.

---

## Ground rules

1. **Copy in, don't install.** [React Bits](https://reactbits.dev) is the main source of ideas. Its components are copy-paste source (license: MIT + Commons Clause — free for commercial use, but the components themselves can't be resold), so we take the idea, rewrite it in our tokens and Tailwind grammar, and own the result. React Bits Pro (paid) is not needed for anything here.
2. **No new runtime dependency for an effect.** `gsap` is already in the bundle (the weekend board's morph, `components/weekend/boardMorphRunner.ts`) and may be used. `motion` / `framer-motion` is not installed; adding it needs a case that CSS plus a small hook cannot make. **No WebGL effects** (`ogl`, `three`) — they run a render loop continuously, whatever the user is doing.
3. **Effects answer the pointer; nothing idles.** A new effect runs only while the user is interacting with it. No looping or ambient animation on new work.
4. **A frame's work is bounded.** Pointer handlers coalesce into one `requestAnimationFrame`, write CSS custom properties, and never set React state. Paint with backgrounds, `transform` and `opacity`. If a custom property must animate, register it with `@property` (an unregistered one snaps instead of fading).
5. **Use the app's tokens.** Colour comes from the theme (`--color-*`) and each surface's own colour, so light and dark both work without a second set of rules.
6. **Fit the effect to the surface.** Choice and first-impression surfaces (the landing page, pickers) can carry more. Working surfaces — the bunking board, the weekend board, tables people drag in all day — get an effect only after a mockup and the owner's sign-off, and **never tilt or move under the pointer** there: that fights drag-and-drop.
7. **Mock first.** Every uplift starts as an interactive mockup (local, in `docs/plans/`) with a control for each open choice, built on the app's real tokens and at the real content size. Visual changes then hold for the owner's review before merge, like any other GUI change.

---

## House effects

### Glow card

**What it looks like:** as the pointer moves over a group of cards, the card under it fills with a soft glow in that card's colour, and card borders light up near the pointer — including the nearest edge of a neighbouring card, so the whole row responds rather than one card at a time.

**Where it lives:**

| Piece | File |
|-------|------|
| Styles (`.glow-card`, `@property --glow-fill`) | `frontend/src/index.css`, next to `.card-lodge` |
| Pointer tracking | `frontend/src/components/ui/useGlowGroup.ts` |
| First use | `frontend/src/pages/ProgramLandingPage.tsx` |

**How to use it:**

```tsx
const glow = useGlowGroup<HTMLDivElement>()

<div {...glow} className="grid …">
  <div data-glow-card="" className="card-lodge glow-card [--glow:var(--color-sky-500)]">…</div>
</div>
```

- Put every card that should respond in **one** group container; the neighbour-edge effect only works within a group.
- Set `--glow` per card to its colour. It defaults to the primary green. A per-theme colour takes two classes: `[--glow:var(--color-amber-600)] dark:[--glow:var(--color-accent)]`.
- Tuning: `--glow-size` (default `360px`) sets the reach of both the fill and the border light; the hover fill strength is `--glow-fill: 18` (percent of the card colour).

**What it costs:** one animation frame per burst of pointer moves, measuring each card's rectangle once and writing two custom properties. Nothing runs when the pointer is outside the group. That is trivial for a handful of cards. **Before using it on a dense surface** (dozens of cards), cache the rectangles and refresh them on resize and scroll, rather than measuring every card every frame.

**Why both layers are backgrounds, not pseudo-elements:** a pseudo-element laid over the card paints above its non-positioned content, and one drawn over the border is clipped by any `overflow: hidden` on the card — the mockup hit the second. Painting the spotlight and the border light as `background` layers (`padding-box` and `border-box`) keeps both under the content and out of reach of clipping. `.glow-card` holds its border colour transparent so the border layer shows through, including over `.card-lodge:hover`.

---

## Decision log

### 2026-09-30 — Program landing page

**Surface:** `ProgramLandingPage` — the program picker. It is shown only when no program is saved (`RootRedirect` in `App.tsx`), so most people see it roughly once per browser; day-to-day switching happens in the header's program menu (`AppLayout`). That made it a cheap place to start: a first impression, where a little flair costs nothing in daily use.

**Prompt:** Camperships is joining as a fourth program (at `/aid`, once its UI launches), and today's three-column grid would leave it orphaned on a row of its own.

**Layouts mocked:** today's grid plus a fourth card, a circular carousel, a 2×2 grid, four across, a bento grid, compact rows, and expanding panels. Shortlist: carousel, 2×2, four across.

**Layout chosen: four across.** The deciding factor was height. The camp logo renders at 320px wide, about 247px tall, above the heading, which pushes the cards down. Bottom of the card row against the viewport (negative means room to spare), measured on the mockup:

| Viewport | Carousel | Four across | 2×2 |
|----------|----------|-------------|-----|
| 1920×1080 | −223px | −275px | −115px |
| 1440×900 | −43px | −95px | 65px below |
| 1366×768 | 89px below | 37px below | 197px below |

Four across is the shortest, keeps every program visible, and takes a fifth program by narrowing rather than wrapping.

**Rejected:**

- **Circular carousel** — the most striking, but it hides three of four programs. With nothing saved it opens on Summer, so the person most likely to arrive new for Camperships (finance) would land looking at bunking, with their program dimmed behind it.
- **2×2** — tallest by far once the logo is in.
- **Expanding panels** — shows a card's details only on hover.

**Effects mocked on the chosen row:** tilt, spotlight, tilt plus spotlight, border glow, spotlight plus border glow, today's lift, and widen-on-hover. Spotlight and border glow each read as similar alone; together they read as one effect with more to it.

**Effect chosen: spotlight plus border glow** — the glow card above. Tilt had the most character on this page, but it can't carry over to working surfaces (rule 6), and the aim was an effect that could become the house style.

**Shipped now:** the glow card on today's three cards, with the page reading its cards from a list (`PROGRAM_CARDS`).

**When Camperships launches at `/aid`,** the landing card is one entry plus these:

- Add the program to the `Program` union and the stored-selection guard in `contexts/ProgramContext.tsx`.
- Add it to `utils/programUrls.ts`: `PROGRAM_HOME`, `PROGRAM_PREFIXES`, `isProgramRoute`, `getProgramFromPath`.
- Add it to the header program menu in `layouts/AppLayout.tsx` — the menu staff actually switch with.
- Add the `PROGRAM_CARDS` entry. The mockup used a berry colour (`hsl(330 55% 42%)` light, `hsl(330 65% 72%)` dark — needs adding as a theme token), lucide's `HandHeart` icon, and "Financial aid applications and awards" with the features *Application review*, *Award rounds against the budget* and *Grantor ledger*. All proposals, not decisions.
- Move the grid to `lg:grid-cols-4` and widen the `max-w-4xl` wrapper — the mockup's row was 1240px.
- Decide whether the card shows to users without access to aid.
