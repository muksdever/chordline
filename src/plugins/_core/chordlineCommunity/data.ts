/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { publicRpc, staffRpc } from "@utils/chordlineSupabase";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, PresenceStore } from "@webpack/common";

// Data for Chordline's community features (see supabase/chordline-community.sql)

const logger = new Logger("ChordlineCommunity", "#e5c890");

const listeners = new Set<() => void>();
export function onCommunityChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}
const emitChange = () => listeners.forEach(l => l());

// --- "Uses Chordline" ---
// While Chordline is running it shows "Playing Chordline" as a Discord activity. Discord shares that live,
// so other Chordline users can see who's using it right now. No database involved.

export const CHORDLINE_ACTIVITY_NAME = "Chordline";
const ACTIVITY_SOCKET = "ChordlineActivity";
const startedAt = Date.now();

export function setChordlineActivity(show: boolean) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        socketId: ACTIVITY_SOCKET,
        activity: show
            ? {
                application_id: "0",
                name: CHORDLINE_ACTIVITY_NAME,
                type: 0,
                state: "Your Discord, your way",
                timestamps: { start: startedAt },
                flags: 1
            }
            : null
    });
}

/** Whether this person has Chordline open right now (from their live Discord activity) */
export const usesChordline = (userId: string) =>
    PresenceStore.getActivities(userId)?.some(a => a.type === 0 && a.name === CHORDLINE_ACTIVITY_NAME) ?? false;

// --- Profile extras ---

export interface ProfileExtras {
    user_id: string;
    primary_color: number | null;
    accent_color: number | null;
    has_banner: boolean;
    updated_at: string;
}

let extras = new Map<string, ProfileExtras>();
/** userId -> banner data URL, only re-downloaded when that profile changes */
const banners = new Map<string, { updatedAt: string; url: string; }>();

export const getProfileExtras = (userId: string) => extras.get(userId);
export const getProfileBanner = (userId: string) => banners.get(userId)?.url;

export async function loadProfileExtras() {
    let list: ProfileExtras[];
    try {
        list = await publicRpc<ProfileExtras[]>("profile_extras_list", {});
    } catch (e) {
        logger.warn("Couldn't load profile extras", e);
        return;
    }

    extras = new Map(list.map(p => [p.user_id, p]));

    await Promise.all(list.map(async p => {
        if (!p.has_banner) return void banners.delete(p.user_id);
        if (banners.get(p.user_id)?.updatedAt === p.updated_at) return;
        try {
            const url = await publicRpc<string | null>("profile_banner", { target_user_id: p.user_id });
            if (url) banners.set(p.user_id, { updatedAt: p.updated_at, url });
        } catch (e) {
            logger.warn("Couldn't load banner for", p.user_id, e);
        }
    }));

    emitChange();
}

export async function saveMyProfileExtras(banner: string | null, primaryColor: number | null, accentColor: number | null) {
    await staffRpc("save_profile_extras", { banner, primary_color: primaryColor, accent_color: accentColor });
    await loadProfileExtras();
}

const BANNER_MAX_WIDTH = 1200;
const BANNER_MAX_HEIGHT = 480;
const BANNER_MAX_LENGTH = 1_400_000;

/** Turns an image into a compressed banner (data URL). Small GIFs stay animated. */
export async function imageToBanner(file: Blob) {
    if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");

    if (file.type === "image/gif" && file.size <= 900 * 1024) {
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(BANNER_MAX_WIDTH / bitmap.width, BANNER_MAX_HEIGHT / bitmap.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    for (const quality of [0.88, 0.75, 0.6, 0.45]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (url.length <= BANNER_MAX_LENGTH) return url;
    }
    throw new Error("That image is too big. Try a smaller one.");
}

// --- Announcements ---

export interface Announcement {
    id: string;
    title: string;
    body: string;
    created_by: string;
    created_at: string;
}

let announcements: Announcement[] = [];
export const getAnnouncements = () => announcements;

export async function loadAnnouncements() {
    try {
        const list = await publicRpc<Announcement[]>("announcements_list", {});
        if (JSON.stringify(list) === JSON.stringify(announcements)) return false;
        announcements = list;
        emitChange();
        return true;
    } catch (e) {
        logger.warn("Couldn't load announcements", e);
        return false;
    }
}

export async function postAnnouncement(title: string, body: string) {
    await staffRpc("announcement_create", { announcement_title: title, announcement_body: body });
    await loadAnnouncements();
}

export async function deleteAnnouncement(id: string) {
    await staffRpc("announcement_delete", { announcement_id: id });
    await loadAnnouncements();
}
