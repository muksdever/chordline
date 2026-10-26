/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

// Chordline's Supabase backend (badges, staff, reports, bans). See the supabase/ folder for the database setup.
// Everyone reads with the public anon key. Staff actions go through database functions that are given
// the logged-in user's Discord ID and check it against the staff list.

// The anon key is meant to be public. Never put the service_role key here.
export const SUPABASE_URL = "https://koknfyzarizfuxfmxkio.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtva25meXphcml6ZnV4Zm14a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5ODUxNjQsImV4cCI6MjEwODU2MTE2NH0.i90UW8EMdV-8RAmEvs21Qzp_RK5nrpnAbYozsRcPfk4";

export const isSupabaseConfigured = () => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

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

/** Calls a database function */
export const publicRpc = <T = void>(fn: string, args: Record<string, unknown>) =>
    supabaseRequest<T>(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

/** Calls a staff database function as the logged-in Discord user */
export function staffRpc<T = void>(fn: string, args: Record<string, unknown>, callerArg = "caller_id") {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return Promise.reject(new Error("Discord hasn't finished loading yet."));
    return publicRpc<T>(fn, { [callerArg]: userId, ...args });
}
