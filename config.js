/* PG Spotlight — shared backend configuration.
 *
 * Leave these blank to run in LOCAL mode (data stays in each browser).
 *
 * To enable a shared, multi-user team leaderboard:
 *   1. Create a free project at https://supabase.com
 *   2. In the project's SQL editor, run the contents of supabase-schema.sql
 *   3. From Project Settings → API, copy the Project URL and the public "anon" key
 *   4. Paste them below and redeploy.
 *
 * The anon key is safe to expose publicly — access is governed by the
 * Row Level Security policies created by supabase-schema.sql.
 */
window.PG_CONFIG = {
  supabaseUrl: "",      // e.g. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",  // e.g. "eyJhbGciOi..."
};
