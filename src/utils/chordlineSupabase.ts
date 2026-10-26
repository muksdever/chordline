/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

// Chordline's Supabase backend (badges, staff, reports, bans). See the supabase/ folder for the database setup.
// Everyone reads with the public anon key. Anything privileged goes through database functions that
// check the caller's secret staff key, which is stored on their own computer only.

// The anon key is meant to be public. Never put the service_role key here.
export const SUPABASE_URL = "https://koknfyzarizfuxfmxkio.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtva25meXphcml6ZnV4Zm14a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODUxNjQsImV4cCI6MjEwODU2MTE2NH0.i90UW8EMdV-8RAmEvs21Qzp_RK5nrpnAbYozsRcPfk4";

export const isSupabaseConfigured = () => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

// IndexedDB on this device only, never in synced or backed-up settings.
// (The name is from when this key was only used for badges.)
const STAFF_KEY_STORE_KEY = "Chordline_badgeAdminKey";

export async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(SUPABASE_URL + path, {
        ...init,
        cache: "no-store",
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            ...init.headers
        }
    });

    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(body?.message ?? res.statusText);
    return body as T;
}

/** Calls a database function without a key */
export const publicRpc = <T = void>(fn: string, args: Record<string, unknown>) =>
    supabaseRequest<T>(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

export const getStaffKey = () => DataStore.get<string>(STAFF_KEY_STORE_KEY);
export const setStaffKey = (key: string) => DataStore.set(STAFF_KEY_STORE_KEY, key);
export const clearStaffKey = () => DataStore.del(STAFF_KEY_STORE_KEY);

/** Calls a database function with this computer's staff key as the first argument */
export async function staffRpc<T = void>(fn: string, args: Record<string, unknown>, keyArg = "staff_key") {
    const key = await getStaffKey();
    if (!key) throw new Error("This computer doesn't have a Chordline staff key.");
    return publicRpc<T>(fn, { [keyArg]: key, ...args });
}
