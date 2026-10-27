/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { useEffect, useReducer, UserStore } from "@webpack/common";

import { isSupabaseConfigured, publicRpc } from "./chordlineSupabase";

// The logged-in Discord user's role on Chordline's staff (see supabase/chordline-staff.sql), looked up by their user ID.

export type StaffRole = "owner" | "dev" | "mod";

const RANKS: Record<StaffRole, number> = { mod: 1, dev: 2, owner: 3 };
export const STAFF_ROLE_NAMES: Record<StaffRole, string> = { owner: "Owner", dev: "Dev", mod: "Mod" };

const logger = new Logger("ChordlineStaff", "#e5c890");
const listeners = new Set<() => void>();

/** The role we looked up, and for which account (so switching accounts doesn't keep the old role) */
let me: { userId: string; role: StaffRole | null; } | null = null;

const currentRole = () => me && me.userId === UserStore.getCurrentUser()?.id ? me.role : null;

/** Whether the logged-in account has at least the given role (owner > dev > mod) */
export const hasStaffRole = (min: StaffRole) => {
    const role = currentRole();
    return !!role && RANKS[role] >= RANKS[min];
};

export function onStaffChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/** The logged-in account's staff role (null if none); re-renders the component when it changes */
export function useStaffRole() {
    const [, rerender] = useReducer(x => x + 1, 0);
    useEffect(() => onStaffChange(rerender), []);
    return currentRole();
}

/** Looks up the logged-in account's staff role */
export async function refreshStaffIdentity() {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId || !isSupabaseConfigured()) return;

    let role: StaffRole | null;
    try {
        role = await publicRpc<StaffRole | null>("staff_role", { caller_id: userId });
    } catch (e) {
        // Keep the role we had if the check just failed (e.g. no internet)
        logger.warn("Couldn't check staff role", e);
        if (me?.userId === userId) return;
        role = null;
    }

    if (me?.userId === userId && me.role === role) return;
    me = { userId, role };
    listeners.forEach(l => l());
}
