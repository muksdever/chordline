/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { useEffect, useReducer } from "@webpack/common";

import { clearStaffKey, getStaffKey, isSupabaseConfigured, setStaffKey, staffRpc } from "./chordlineSupabase";

// Who this Chordline user is on Chordline's staff (see supabase/chordline-staff.sql), based on their staff key.

export type StaffRole = "owner" | "dev" | "mod";

const RANKS: Record<StaffRole, number> = { mod: 1, dev: 2, owner: 3 };
export const STAFF_ROLE_NAMES: Record<StaffRole, string> = { owner: "Owner", dev: "Dev", mod: "Mod" };

interface StaffIdentity {
    user_id: string;
    role: StaffRole;
}

const logger = new Logger("ChordlineStaff", "#e5c890");
const listeners = new Set<() => void>();

let me: StaffIdentity | null = null;

export const getStaffIdentity = () => me;

/** Whether this user has at least the given role (owner > dev > mod) */
export const hasStaffRole = (min: StaffRole) => !!me && RANKS[me.role] >= RANKS[min];

export function onStaffChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** Re-renders the component when this user's staff role changes */
export function useStaffRole() {
    const [, rerender] = useReducer(x => x + 1, 0);
    useEffect(() => onStaffChange(rerender), []);
    return me?.role ?? null;
}

function setIdentity(identity: StaffIdentity | null) {
    me = identity;
    listeners.forEach(l => l());
}

/** Checks this computer's staff key with the database */
export async function refreshStaffIdentity() {
    if (!isSupabaseConfigured() || !await getStaffKey()) return setIdentity(null);

    try {
        setIdentity(await staffRpc<StaffIdentity>("staff_whoami", {}));
    } catch (e) {
        logger.warn("Staff key was not accepted", e);
        setIdentity(null);
    }
}

/** Saves a staff key on this computer if the database accepts it */
export async function saveStaffKey(key: string) {
    const previous = await getStaffKey();
    await setStaffKey(key);
    try {
        setIdentity(await staffRpc<StaffIdentity>("staff_whoami", {}));
    } catch (e) {
        if (previous) await setStaffKey(previous);
        else await clearStaffKey();
        throw new Error("That staff key wasn't accepted. Check you copied all of it.");
    }
}

export async function forgetStaffKey() {
    await clearStaffKey();
    setIdentity(null);
}
