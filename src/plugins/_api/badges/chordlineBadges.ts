/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { saveStaffKey } from "@utils/chordlineStaff";
import { getStaffKey, isSupabaseConfigured, publicRpc, staffRpc, supabaseRequest as request } from "@utils/chordlineSupabase";
import { Logger } from "@utils/Logger";

// Chordline badges are stored in Supabase (see supabase/chordline-badges.sql).
// Everyone reads them with the public anon key. Changes go through admin_* database functions
// that require a dev or owner staff key (see @utils/chordlineSupabase).

/** Badge images are resized to this many pixels square before being stored */
const ICON_SIZE = 96;

const logger = new Logger("ChordlineBadges", "#e5c890");

export interface ChordlineBadge {
    id: string;
    name: string;
    icon_url: string;
    /** 1 (Common) to 5 (Legendary), same scale as Discord's badges */
    rarity: number;
    created_at: string;
}

export const BADGE_RARITIES = [
    { value: 1, label: "Common" },
    { value: 2, label: "Uncommon" },
    { value: 3, label: "Rare" },
    { value: 4, label: "Epic" },
    { value: 5, label: "Legendary" },
] as const;

export interface BadgeHolder {
    badge_id: string;
    user_id: string;
    hidden: boolean;
    position: number | null;
    created_at: string;
}

/** Badge ids used in Discord's badge UI and profile badge lists, so they can't clash with Discord's own */
export const CHORDLINE_BADGE_PREFIX = "chordline_badge_";
export const isChordlineBadgeId = (id: unknown): id is string => typeof id === "string" && id.startsWith(CHORDLINE_BADGE_PREFIX);
export const toChordlineBadgeId = (uuid: string) => CHORDLINE_BADGE_PREFIX + uuid;
export const fromChordlineBadgeId = (id: string) => id.slice(CHORDLINE_BADGE_PREFIX.length);

export interface HeldBadge {
    badge: ChordlineBadge;
    hidden: boolean;
    obtainedAt: string;
}

export const isBadgeBackendConfigured = isSupabaseConfigured;

let badges: ChordlineBadge[] = [];
let holders: BadgeHolder[] = [];
/** Every badge each user has, in their chosen order, including hidden ones */
let badgesByUser = new Map<string, HeldBadge[]>();

const listeners = new Set<() => void>();
export function onChordlineBadgesChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

export const getAllChordlineBadges = () => badges;
export const getBadgeHolders = (badgeId: string) => holders.filter(h => h.badge_id === badgeId).map(h => h.user_id);
export const getHeldBadges = (userId: string) => badgesByUser.get(userId) ?? [];
/** The badges that should show on this user's profile, in order */
export const getUserChordlineBadges = (userId: string) => getHeldBadges(userId).filter(h => !h.hidden).map(h => h.badge);

export async function loadChordlineBadges() {
    if (!isBadgeBackendConfigured()) return;

    try {
        [badges, holders] = await Promise.all([
            request<ChordlineBadge[]>("/rest/v1/badges?select=id,name,icon_url,rarity,created_at&order=created_at.asc"),
            request<BadgeHolder[]>("/rest/v1/badge_holders?select=badge_id,user_id,hidden,position,created_at&order=created_at.asc")
        ]);
    } catch (e) {
        logger.error("Failed to load badges", e);
        return;
    }

    rebuildBadgesByUser();
}

function rebuildBadgesByUser() {
    const byId = new Map(badges.map(b => [b.id, b]));
    badgesByUser = new Map();

    // Users' chosen order first, then badges they haven't ordered yet, oldest first
    const sorted = holders.toSorted((a, b) =>
        (a.position ?? Infinity) - (b.position ?? Infinity) || a.created_at.localeCompare(b.created_at));

    for (const { badge_id, user_id, hidden, created_at } of sorted) {
        const badge = byId.get(badge_id);
        if (!badge) continue;
        if (!badgesByUser.has(user_id)) badgesByUser.set(user_id, []);
        badgesByUser.get(user_id)!.push({ badge, hidden, obtainedAt: created_at });
    }

    listeners.forEach(l => l());
}

/**
 * Saves the order and hidden state of a user's own Chordline badges (from Discord's badge customization).
 * Either list can be left out to keep the current value. Ids are Chordline badge ids (with prefix).
 */
export async function saveOwnBadgeSettings(userId: string, displayOrder?: string[], hiddenBadges?: string[]) {
    const held = getHeldBadges(userId);
    if (!held.length) return;

    const order = displayOrder?.map(fromChordlineBadgeId)
        ?? held.filter(h => !h.hidden).map(h => h.badge.id);
    const hidden = new Set(hiddenBadges?.map(fromChordlineBadgeId)
        ?? held.filter(h => h.hidden).map(h => h.badge.id));

    // Update locally right away so the UI doesn't flicker back while saving
    for (const h of holders) {
        if (h.user_id !== userId) continue;
        h.hidden = hidden.has(h.badge_id);
        const pos = order.indexOf(h.badge_id);
        h.position = pos === -1 ? null : pos + 1;
    }
    rebuildBadgesByUser();

    try {
        await publicRpc("save_badge_settings", { discord_user_id: userId, display_order: order, hidden_badges: [...hidden] });
    } catch (e) {
        logger.error("Failed to save badge settings", e);
        await loadChordlineBadges();
        throw e;
    }
}

// --- Admin actions (need a dev or owner staff key) ---

export async function hasAdminKey() {
    return !!await getStaffKey();
}

/** Saves a staff key on this computer if the database accepts it */
export const setAdminKey = saveStaffKey;

async function rpc<T = void>(fn: string, args: Record<string, string | number>) {
    const result = await staffRpc<T>(fn, args, "admin_key");
    await loadChordlineBadges();
    return result;
}

export const createBadge = (name: string, iconUrl: string, rarity: number) =>
    rpc<string>("admin_create_badge", { badge_name: name, badge_icon: iconUrl, badge_rarity: rarity });

export const updateBadge = (id: string, name: string, iconUrl: string, rarity: number) =>
    rpc("admin_update_badge", { badge_id: id, badge_name: name, badge_icon: iconUrl, badge_rarity: rarity });

export const deleteBadge = (badge: ChordlineBadge) =>
    rpc("admin_delete_badge", { badge_id: badge.id });

export const giveBadge = (badgeId: string, userId: string) =>
    rpc("admin_give_badge", { badge_id: badgeId, discord_user_id: userId });

export const takeBadge = (badgeId: string, userId: string) =>
    rpc("admin_take_badge", { badge_id: badgeId, discord_user_id: userId });

// --- Images ---

function readAsDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/**
 * Turns an image file into a small embedded image (data URL) that is stored with the badge.
 * Small GIFs are kept as-is so they stay animated; everything else is resized to a PNG.
 */
export async function imageToBadgeIcon(file: File) {
    if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");

    if (file.type === "image/gif" && file.size <= 140 * 1024)
        return readAsDataUrl(file);

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(ICON_SIZE / bitmap.width, ICON_SIZE / bitmap.height, 1);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return canvas.toDataURL("image/png");
}
