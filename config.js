/* PG Spotlight — shared backend configuration.
 *
 * Shared team mode is ON: the app syncs to Supabase (see share.js), so everyone
 * who opens it sees the same live ranking. The values below are also baked into
 * share.js; setting them here lets you override without touching share.js.
 *
 * The publishable key is safe to expose publicly — access is governed by the
 * Row Level Security policies created by supabase-schema.sql.
 */
window.PG_CONFIG = {
  supabaseUrl: "https://qodolcmtrpczpaueifyh.supabase.co",
  supabasePublishableKey: "sb_publishable_el0wj5epMvdnWYy0ALCRMw_DqZoF0oO",

  // Legacy field (older anon JWT key). Leave blank when using a publishable key.
  supabaseAnonKey: "",
};
