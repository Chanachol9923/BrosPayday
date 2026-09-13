# BrosPayday

Split any bill fairly — and show your work, so nobody argues.

Add the people, add what was bought, tap who paid and who shared it. BrosPayday works out
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

## Three ways to use it

There is no demo data and nothing seeded. What differs is where the data lives.

**Signed in.** Sign in with Google, start or join a *Group*, and your parties follow
you to any device — and everyone in the Group sees them, updating live as people add
what they bought. Photos go to private storage, cached locally so a party you have
opened still works with no signal.

**On this device only.** The original behaviour, still offered plainly on the first
screen and still first-class: nothing uploaded, no account, no server. Anything saved
this way is offered up as a copy the first time you join a Group — the local copy is
kept either way.

**Holding a link.** You do not need an account to open a party someone shared. A view
link shows the split and the proof with nothing editable; an edit link lets you add
what you bought, and it reaches that one party and nothing else.

Turning cloud sync on is a five-minute setup, documented in [SETUP.md](SETUP.md). With
no keys configured the app simply runs local-only.

## Who can see what

Every access question reduces to one: *are you in the Group that owns this?* That is
enforced in Postgres by row-level security, not in the client, so a key in a browser
bundle grants nothing on its own. `supabase/tests/rls.sql` proves it by impersonating
two users and checking what each can actually reach — a stranger sees no parties, no
expenses, no people and not even the Group's name, and is refused on write. Run it with
`npm run verify:rls`; it rolls back and leaves no trace.

## How a session works

Opening the site hands you a **clean sheet**, not last night's party — but pressing
refresh mid-party never wipes your work. A marker in `sessionStorage` tells the two
apart: it survives a reload and dies with the tab. Whatever you were working on is
filed into **History** automatically as the new session starts, so nothing is lost
by simply closing the tab.

History keeps the name you gave the party and the date it happened (both editable,
and the date defaults to today). Search it by name, date or who was there. Opening
an entry puts it back on the workbench and files the current one away — a swap, not
a copy, so parties never quietly duplicate.

## Users

A friend group usually shares one phone at the table. Press the profile chip, add a
name, and that person gets their own parties, history and presets. No password and
no account — it is a way to keep separate tabs on one device, not a security
boundary. Switching users starts that person's session fresh the same way.

## Presets

A preset is your usual crew saved under a name — “Bros”, “Office lunch”. Since every
visit starts blank, one tap puts everybody back. Presets also remember the names of
the expenses you usually have (“Pork”, “Karaoke room”) and offer them as one-tap
starters. **Amounts are never stored in a preset.**

## Photos

Snap receipts as you shop — as many as you like. Tap a photo later to attach it to an
expense, or leave it loose as a record of the night.

Photos never touch `localStorage`; a handful of phone snaps would blow past its ~5MB
quota and take the whole party history with them. Blobs live in **IndexedDB** and the
party record keeps only small metadata. Every image is re-encoded on the way in: a
1600px copy you can read a receipt from plus a 240px thumbnail, so a 4MB phone photo
lands around 250KB. Orphaned blobs are swept on start-up.

Photos are on one device and do not travel in a share link.

## Payment QR

Anybody who is owed money can add a way to be paid back. It is entirely optional, and
there are two ways:

- **Paste or upload their own QR** — the screenshot from their banking app. Works for
  any bank or wallet, but a saved QR carries no amount, so the app tells the payer what
  to type.
- **Type a PromptPay number** — then BrosPayday builds the QR itself with **the exact
  amount already in it**, so there is nothing to key in at all.

Either way it is stored against the person's name for that user, so it comes back
automatically in the next party without being retyped.

Tap a row under *Who pays whom* and the recipient's QR comes up with the amount beside
it. The payload is the Thai EMVCo standard, built in `lib/promptpay.ts` and pinned
byte-for-byte by the suite, including the published CRC-16/CCITT-FALSE check value and
a tampering check. A malformed payload cannot silently misdirect money — a banking app
validates the CRC before it shows anything, so the failure mode is a QR that will not
scan. The digits still come from whatever was typed, which is why the app reads the
number back to you before you save it.

## Sharing

Two different things share the same button.

A **live link** exists only with cloud sync on. It stays in step with the party and
comes in two roles — view, or add-what-you-bought. Writes from an edit link go through
a database function that pins every change to the party the token was issued for, so
holding a link is not the same as being in the Group. Links can be revoked.

A **snapshot link** needs no server at all: the whole party is packed into the URL
fragment, which is never even sent to the host. Whoever opens it gets their own frozen
copy. This is the only kind available in local-only mode.

Press Share and you get a card showing exactly what is about to leave your phone —
the party, the date, the people, the total, and your name as the sender. Then:

- **Share…** hands it to the OS share sheet (straight into LINE, WhatsApp, wherever)
  where the browser supports it;
- **Copy link** puts the whole party in a URL;
- **Copy summary for chat** produces plain text to paste.

The party is packed into the link's fragment, so **nothing is uploaded** — there is no
server holding anyone's numbers, and the fragment is never even sent to the host.
Whoever opens the link sees a preview first and chooses **Open it** (onto their
workbench, their own party saved to history first) or **Save to history** (filed away,
nothing disturbed). Links made by older versions still open.

## What it handles

- **Uneven groups** — only some people share the pork, only some drink.
- **Someone treating** — one person pays, a different person carries the cost.
- **Uneven shares** — `×2` / `×3` weights when one person had noticeably more.
- **Someone else paying part of it** — any person can be the payer on any expense.
- **Exact rounding** — everything is computed in minor units (satang/cents) with the
  largest-remainder method, so the parts always add back to the exact bill. No lost coins.
- **15 currencies**, including zero-decimal ones (JPY, KRW, VND, IDR).

Everything is saved to `localStorage` on the device that created it.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Verifying the maths

Don't take the split on faith — run it:

```bash
npm run verify
```

`tests/verify.js` generates ~228,000 splits and 20,000 random parties from a fixed
seed and asserts the invariants that actually matter:

- every expense's parts sum to **exactly** the bill, with nobody more than one minor
  unit above anyone else, and a larger share never paying less than a smaller one;
- the sum of everyone's share equals the total spent;
- all balances cancel to zero;
- the settlement never needs more than *people − 1* transfers, none of them zero or
  negative or self-directed, and replaying them leaves **every** person on zero.

It pins what the screen actually prints, too — every balance card, the proof's total
row, and the chat summary are compared string for string against the reference party,
so a display change cannot quietly corrupt a number. That pin has teeth: shifting one
expense by a single baht trips four separate assertions.

It also pins the edge cases a real user can reach — the payer being deleted, an
expense nobody shares, a person listed twice by a hand-edited share link, `10 ÷ 3`,
one person treating another, switching between 2-decimal and 0-decimal currencies,
and a share link round trip.

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
  Sheet             the one modal shell (bottom sheet / centred dialog)
  QrCode            inline SVG QR, always on a light plate
  Photo             async image from IndexedDB
  PhotoShelf        the receipts grid
  PhotoViewer       lightbox, attach-to-expense, delete
  MemberSheet       a member's name and how to pay them
  PayQrSheet        the QR for one settlement
  PartyHeader       party name and date
  PeoplePanel       add / rename / remove people, preset chips
  ExpenseList       the expense rows and preset starters
  ExpenseSheet      editor with a live split preview
  Results           totals, who-pays-whom, per-person balances
  Proof             the four-step derivation and the checks
  ProfileSheet      add / switch / rename / delete users
  HistorySheet      past parties, searchable
  PresetSheet       save, apply and manage templates
  ShareSheet        share card, native share, link, summary
  ImportSheet       preview of an incoming shared party
lib/
  cloud/            everything that talks to Postgres
    diff.ts         a changed state reduced to row-level writes
    api.ts          groups, loading, applying, realtime, share links
    useCloud.ts     session, Group selection, push and pull
    photos.ts       the private storage bucket
  supabase/         the browser client, null when unconfigured
  split.ts          allocate() + computeSplit() + settle()  ← all the maths
  promptpay.ts      Thai EMVCo QR payloads + CRC-16
  photos.ts         IndexedDB blob store, resizing, orphan sweep
  store.ts          profiles, history, presets, payees, session handling
  share.ts          the link codec
  types.ts          data model and currency table
  format.ts         money parsing and formatting
tests/
  verify.js         the correctness suite
  fixture.js        the hand-worked reference party the suite checks against
```

All arithmetic lives in `lib/split.ts` and is integer-only — the UI never does money maths.
Everything that moves parties between the workbench, history and presets lives in
`lib/store.ts` as pure functions, which is why the suite can exercise it directly.
