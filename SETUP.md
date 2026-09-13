> **This project is already set up.** The steps below are the record of how, and
> what to repeat if you ever move to a different Supabase project. Both migrations
> are applied, Google sign-in is live, and the keys are set locally and on Vercel.

# Turning on cloud sync

BrosPayday works with no server at all — everything sits in the browser. That is
still the default, and the app runs exactly as before if you skip this file.

Setting up Supabase adds the things a browser alone cannot do: your parties follow
you to another phone or laptop, and the people in your group see each other's.

These steps need your own account, so they are yours to do. It takes about five
minutes and costs nothing on the free tier.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. **New project** → give it a name (`brospayday`), pick a region close to you
   (Singapore is the nearest to Thailand) and set a database password.
3. Wait for it to finish provisioning.

## 2. Run the schema

1. In the project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. **Run**. It should finish with no errors.

This creates the tables, the row-level security policies that scope everything to
your group, the private photo bucket, and the live-update publication.

## 3. Turn on Google sign-in

1. **Authentication** → **Providers** → **Google** → enable it.
2. Supabase shows you a **callback URL** — copy it.
3. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - **Create credentials** → **OAuth client ID** → **Web application**
   - Under *Authorised redirect URIs*, paste the callback URL from Supabase
   - Create it, then copy the **Client ID** and **Client secret**
4. Paste both back into the Supabase Google provider settings and save.

## 4. Tell the app where to find it

In Supabase, **Project Settings** → **API**, copy the **Project URL** and the
**anon public** key.

**Locally** — create `.env.local` in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

**On Vercel** — Project → Settings → Environment Variables, add the same two for
Production, Preview and Development, then redeploy.

> The anon key is meant to be public; it is safe in a browser bundle. What actually
> protects your data is the row-level security from step 2 — the key alone lets
> nobody read a group they are not a member of. Never put the `service_role` key
> anywhere near the app.

## 5. Add the redirect URLs

**Authentication** → **URL Configuration**:

- **Site URL**: `https://brospayday.vercel.app`
- **Redirect URLs**: add both
  - `https://brospayday.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback`

Without the localhost entry, signing in while developing bounces you to production.

---

## Then

Reload the app. You will be asked to sign in with Google, and after that to start a
Group or join one with a code. Anything already saved on that device is offered up to
the cloud on the first sign-in, so nothing from before is lost.

To bring someone in: **⋯ → Group → Invite**, and send them the link or the code.

## Two kinds of share link

Once cloud sync is on, a party can be shared two ways, and neither needs the other
person to sign in or install anything:

- **View link** — they see the split and the proof, and can change nothing.
- **Edit link** — they can add what they bought and fix their own rows.

An edit link is scoped to that one party. It cannot rename the night, cannot reach
your other parties, and cannot touch the group. That is enforced in the database:
every write from a link goes through a function that pins the change to the party
the token was issued for, so holding the link is not the same as being in the crew.

Links can be revoked at any time.

## If you skip all this

The app falls back to the way it worked before: everything local to that one
browser, no sign-in, no sharing beyond sending a link. Nothing breaks.
