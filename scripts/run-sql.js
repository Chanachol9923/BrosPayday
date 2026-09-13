/**
 * Runs a multi-statement SQL file against the project database.
 *
 * Used by `npm run verify:rls`, which proves the access rules still hold — that a
 * stranger sees nothing, that a view link cannot write, that an edit link cannot
 * reach another party. The script wraps itself in a transaction and rolls back, so
 * running it leaves no trace.
 *
 * Needs a connection string, which is never stored in the repo:
 *
 *   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres'  *     npm run verify:rls
 *
 * Take it from Supabase: Project Settings -> Database -> Connection string ->
 * Session pooler. A password containing @ or : must be percent-encoded.
 */
const fs = require('fs');
const { Client } = require('pg');

if (!process.env.SUPABASE_DB_URL && !process.env.DBURL) {
  console.error('Set SUPABASE_DB_URL first — see the comment at the top of this file.');
  process.exit(1);
}

(async () => {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL || process.env.DBURL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const sql = fs.readFileSync(process.argv[2], 'utf8');
    const res = await client.query(sql);
    const sets = Array.isArray(res) ? res : [res];
    const rows = sets.flatMap((r) => r.rows || []);
    if (rows.length === 0) { console.log('(no rows returned)'); return; }
    // Check rows can appear anywhere in the output, since earlier statements in a
    // script return rows of their own. Counting only the ones that are checks
    // keeps a failure from hiding behind an unrelated result set.
    let bad = 0;
    let checks = 0;
    for (const r of rows) {
      if (r.result !== undefined) {
        checks++;
        if (String(r.result).trim() === 'FAIL') bad++;
        console.log('  ' + r.result + '  ' + String(r.check_name).padEnd(42) + '  ' + r.detail);
      } else {
        console.log('  ' + JSON.stringify(r));
      }
    }

    if (checks === 0) {
      console.log('\n  NO CHECKS RAN — the script returned no result rows');
      process.exitCode = 1;
      return;
    }

    console.log('\n  ' + (bad ? bad + ' FAILURE(S) of ' + checks : 'ALL ' + checks + ' CHECKS PASSED'));
    if (bad) process.exitCode = 1;
  } finally {
    await client.end();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
