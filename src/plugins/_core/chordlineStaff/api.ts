/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { StaffRole } from "@utils/chordlineStaff";
import { publicRpc, staffRpc } from "@utils/chordlineSupabase";

// Wrappers around the database functions in supabase/chordline-staff.sql

export interface StaffMember {
    user_id: string;
    role: StaffRole;
    added_by: string | null;
    created_at: string;
}

export interface Report {
    id: string;
    reported_user_id: string;
    reporter_id: string;
    reason: string;
    message_content: string | null;
    message_link: string | null;
    /** Screenshot attached as proof, as an embedded image (data URL) */
    proof_image: string | null;
    created_at: string;
}

export interface Ban {
    user_id: string;
    reason: string;
    banned_by: string;
    /** null = permanent */
    expires_at: string | null;
    created_at: string;
}

export const BAN_DURATIONS = [
    { label: "1 hour", minutes: 60 },
    { label: "1 day", minutes: 60 * 24 },
    { label: "3 days", minutes: 60 * 24 * 3 },
    { label: "1 week", minutes: 60 * 24 * 7 },
    { label: "30 days", minutes: 60 * 24 * 30 },
    { label: "Permanent", minutes: null },
] as const;

export const listStaff = () => staffRpc<StaffMember[]>("staff_list", {});

/** Adds someone as dev or mod, or changes their role */
export const setStaff = (userId: string, role: "dev" | "mod") =>
    staffRpc("staff_set", { target_user_id: userId, new_role: role });

export const removeStaff = (userId: string) => staffRpc("staff_remove", { target_user_id: userId });

export const createReport = (report: { userId: string; reason: string; proof: string | null; messageContent?: string; messageLink?: string; }) =>
    staffRpc("report_create", {
        target_user_id: report.userId,
        report_reason: report.reason,
        content: report.messageContent ?? null,
        link: report.messageLink ?? null,
        proof: report.proof
    });

/** Biggest width/height proof images are shrunk to, so screenshots stay readable but small */
const PROOF_MAX_SIZE = 1600;
const PROOF_MAX_LENGTH = 1_900_000;

/** Turns a screenshot into a compressed embedded image (data URL) for a report */
export async function imageToProof(file: Blob) {
    if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(PROOF_MAX_SIZE / bitmap.width, PROOF_MAX_SIZE / bitmap.height, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext("2d")!;
    // JPEG has no transparency, so transparent areas get Discord's dark background instead of black
    ctx.fillStyle = "#1e1f22";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (url.length <= PROOF_MAX_LENGTH) return url;
    }
    throw new Error("That image is too big. Try cropping it.");
}

export const listReports = () => staffRpc<Report[]>("reports_list", {});

export const dismissReport = (reportId: string) => staffRpc("report_dismiss", { target_report_id: reportId });

export const addBan = (userId: string, reason: string, durationMinutes: number | null, fromReportId?: string) =>
    staffRpc("ban_add", { target_user_id: userId, ban_reason: reason, duration_minutes: durationMinutes, from_report_id: fromReportId ?? null });

export const removeBan = (userId: string) => staffRpc("ban_remove", { target_user_id: userId });

export const listBans = () => staffRpc<Ban[]>("bans_list", {});

/** Anyone can check whether a user is banned (Chordline does this for its own user on startup) */
export const getBan = (userId: string) =>
    publicRpc<Pick<Ban, "reason" | "expires_at" | "created_at"> | null>("get_ban", { target_user_id: userId });

export function timeAgo(date: string) {
    const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

/** "2d 4h 13m 5s" */
export function formatDuration(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor(total % 86400 / 3600);
    const m = Math.floor(total % 3600 / 60);
    const s = total % 60;
    return [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}
