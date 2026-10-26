/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findStore } from "@webpack";
import { showToast, UserStore } from "@webpack/common";

import { getHeldBadges, HeldBadge, isChordlineBadgeId, onChordlineBadgesChange, saveOwnBadgeSettings, toChordlineBadgeId } from "./chordlineBadges";

// Puts Chordline badges into Discord's BadgeDirectoryStore, which powers "Your Badges" and badge customization,
// so they can be viewed, hidden and reordered there like Discord's own badges.

const logger = new Logger("ChordlineBadgeDirectory", "#e5c890");

interface BadgeDirectoryStore {
    getBadges(userId?: string): any[];
    getBadgeById(badgeId: unknown, userId?: string): any;
    emitChange(): void;
}

let store: BadgeDirectoryStore | undefined;
let originalGetBadges: BadgeDirectoryStore["getBadges"] | undefined;
let originalGetBadgeById: BadgeDirectoryStore["getBadgeById"] | undefined;
let unsubscribe: (() => void) | undefined;

// Cache entries so the same badge keeps the same object while nothing changed (keeps React from re-rendering)
const entryCache = new Map<string, { held: HeldBadge; entry: any; }>();

function toCatalogEntry(userId: string, held: HeldBadge) {
    const key = `${userId}:${held.badge.id}`;
    const cached = entryCache.get(key);
    if (cached?.held === held) return cached.entry;

    const { badge } = held;
    const entry = {
        badge_id: toChordlineBadgeId(badge.id),
        name: badge.name,
        description: "A Chordline badge",
        info_label: "Chordline",
        rarity: badge.rarity ?? 1,
        simple_icon_url: badge.icon_url,
        simple_icon_raster_url: badge.icon_url,
        complex_icon_static_url: badge.icon_url,
        is_earnable: false,
        owned: true,
        hidden: held.hidden,
        obtained_at: held.obtainedAt,
        tiers: [],
        progress: []
    };
    entryCache.set(key, { held, entry });
    return entry;
}

const resolveUserId = (userId?: string) => userId ?? UserStore.getCurrentUser()?.id;

export function hookBadgeDirectory() {
    if (store) return;

    try {
        store = findStore("BadgeDirectoryStore") as unknown as BadgeDirectoryStore;
    } catch {
        logger.warn("BadgeDirectoryStore not found, Chordline badges won't show in Discord's badge settings");
        return;
    }

    originalGetBadges = store.getBadges;
    originalGetBadgeById = store.getBadgeById;

    store.getBadges = function (userId) {
        const base = originalGetBadges!.call(this, userId);
        const id = resolveUserId(userId);
        const held = id ? getHeldBadges(id) : [];
        // Only add to users Discord has a catalog for, otherwise Discord's UI is still loading
        return held.length && base.length
            ? [...base, ...held.map(h => toCatalogEntry(id!, h))]
            : base;
    };

    store.getBadgeById = function (badgeId, userId) {
        if (!isChordlineBadgeId(badgeId)) return originalGetBadgeById!.call(this, badgeId, userId);

        const id = resolveUserId(userId);
        const held = id ? getHeldBadges(id).find(h => toChordlineBadgeId(h.badge.id) === badgeId) : undefined;
        return held && toCatalogEntry(id!, held);
    };

    unsubscribe = onChordlineBadgesChange(() => store?.emitChange());
}

export function unhookBadgeDirectory() {
    if (!store) return;
    store.getBadges = originalGetBadges!;
    store.getBadgeById = originalGetBadgeById!;
    unsubscribe?.();
    store = undefined;
    entryCache.clear();
}

/**
 * Called with the body of Discord's badge settings save request.
 * Saves the Chordline part to Supabase and returns the rest for Discord.
 */
export function splitBadgeSettings(body: { display_order?: unknown[]; hidden_badges?: unknown[]; }) {
    if (!body) return body;

    const userId = UserStore.getCurrentUser()?.id;
    const ours = (list?: unknown[]) => list?.filter(isChordlineBadgeId);
    const theirs = (list?: unknown[]) => list?.filter(id => !isChordlineBadgeId(id));

    const ourOrder = ours(body.display_order);
    const ourHidden = ours(body.hidden_badges);

    if (userId && getHeldBadges(userId).length && (ourOrder || ourHidden)) {
        saveOwnBadgeSettings(userId, ourOrder, ourHidden).catch(() =>
            showToast({ text: "Couldn't save your Chordline badge settings", variant: "critical", position: "bottom" })
        );
    }

    return {
        ...body.display_order && { display_order: theirs(body.display_order) },
        ...body.hidden_badges && { hidden_badges: theirs(body.hidden_badges) }
    };
}
