import { createClient } from "@supabase/supabase-js";

// The anon key is public client configuration. Real protection comes from Supabase RLS policies in supabase/schema.sql.
const FALLBACK_SUPABASE_URL = "https://dlanhmfeuhdfdnycqtxd.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsYW5obWZldWhkZmRueWNxdHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MjM2MTIsImV4cCI6MjA5MzE5OTYxMn0.WADgjug7M0q61u53RC5ZN2HDnBE_-AvNkMmqxnctXB8";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

let client;

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.includes("supabase.co"));
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
