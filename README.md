# PartyPayday

Split any bill fairly — and show your work, so nobody argues.

Add the people, add what was bought, tap who paid and who shared it. PartyPayday works out
what each person actually owes, reduces it to the fewest possible transfers, and lays out the
full derivation step by step.

Built mobile-first, dark theme, no account, no backend.

## Why the proof matters

Most split-the-bill tools hand you a number and expect you to trust it. This one shows:

1. **How each expense was divided** — the actual division, person by person.
2. **Everyone's share, expense by expense** — a matrix where each column adds back to the bill.
3. **Paid versus owed** — what you put in, what you used, and the difference.
4. **Settling up** — which transfers clear it, plus a replay proving every balance lands on zero.
5. **Automatic checks** — four invariants re-run on every change.

## What it handles

- **Uneven groups** — only some people share the pork, only some drink.
- **Someone treating** — one person pays, a different person carries the cost.
- **Uneven shares** — `×2` / `×3` weights when one person had noticeably more.
- **Someone else paying part of it** — any person can be the payer on any expense.
- **Exact rounding** — everything is computed in minor units (satang/cents) with the
  largest-remainder method, so the parts always add back to the exact bill. No lost coins.
- **15 currencies**, including zero-decimal ones (JPY, KRW, VND, IDR).

## Sharing

- **Copy summary for chat** — plain text ready to paste into a group chat.
- **Copy share link** — the whole party is encoded in the URL fragment. Nothing is uploaded;
  the data lives in the link itself and in the recipient's browser.

Everything else is saved to `localStorage` on the device that created it.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

This is a stock Next.js App Router project — no environment variables, no database, no
configuration required.

**From the dashboard:** push this repo to GitHub/GitLab/Bitbucket, then
[import it on Vercel](https://vercel.com/new). The framework is detected automatically.

**From the CLI:**

```bash
npx vercel
```

then, once it looks right:

```bash
npx vercel --prod
```

## Project layout

```
app/
  page.tsx          orchestration: state, persistence, sharing
  layout.tsx        metadata, viewport, theme colour
  globals.css       design tokens + every component style
components/
  PeoplePanel       add / rename / remove people
  ExpenseList       the expense rows
  ExpenseSheet      bottom sheet editor with a live split preview
  Results           totals, who-pays-whom, per-person balances
  Proof             the four-step derivation and the checks
lib/
  split.ts          allocate() + computeSplit() + settle()  ← all the maths
  types.ts          data model and currency table
  format.ts         money parsing and formatting
  share.ts          link codec and localStorage
  example.ts        the sample party
```

All arithmetic lives in `lib/split.ts` and is integer-only — the UI never does money maths.
