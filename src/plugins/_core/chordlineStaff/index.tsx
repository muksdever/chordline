/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { hasStaffRole, refreshStaffIdentity } from "@utils/chordlineStaff";
import { isSupabaseConfigured } from "@utils/chordlineSupabase";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import type { Channel, Message, User } from "@vencord/discord-types";
import { Menu, UserStore } from "@webpack/common";

import { getBan } from "./api";
import { hideBanScreen, isBanScreenShown, showBanScreen } from "./banScreen";
import { openBansModal, openReportModal, openReportsModal, openStaffModal } from "./windows";

const logger = new Logger("ChordlineStaff", "#e5c890");

const BAN_CHECK_INTERVAL = 5 * 60 * 1000;
let banCheckTimer: ReturnType<typeof setInterval> | undefined;
let checkingBan = false;

async function checkBan() {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId || checkingBan || !isSupabaseConfigured()) return;

    checkingBan = true;
    try {
        const ban = await getBan(userId);
        if (ban) showBanScreen(ban, checkBan);
        else if (isBanScreenShown()) hideBanScreen();
    } catch (e) {
        logger.warn("Couldn't check ban status", e);
    } finally {
        checkingBan = false;
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || !hasStaffRole("mod") || user.id === UserStore.getCurrentUser()?.id) return;

    children.push(
        <Menu.MenuItem
            id="vc-chordline-report-user"
            label="Report to Chordline"
            color="danger"
            action={() => openReportModal({ userId: user.id })}
        />
    );
};

const MessageContextMenuPatch: NavContextMenuPatchCallback = (children, { message, channel }: { message?: Message; channel?: Channel; }) => {
    if (!message || !channel || !hasStaffRole("mod") || message.author.id === UserStore.getCurrentUser()?.id) return;

    const link = `https://discord.com/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`;
    children.push(
        <Menu.MenuItem
            id="vc-chordline-report-message"
            label="Report to Chordline"
            color="danger"
            action={() => openReportModal({
                userId: message.author.id,
                messageContent: message.content?.slice(0, 4000) || "(no text, e.g. only an attachment or embed)",
                messageLink: link
            })}
        />
    );
};

export default definePlugin({
    name: "ChordlineStaff",
    description: "Chordline's staff tools: reports, bans and the staff team",
    authors: [{ name: "mukman", id: 1361146748449460375n }],
    required: true,

    toolboxActions() {
        if (!hasStaffRole("dev")) return null;

        return (
            <>
                <Menu.MenuItem id="vc-chordline-staff" label="Staff" action={openStaffModal} />
                <Menu.MenuItem id="vc-chordline-reports" label="Reports" action={openReportsModal} />
                <Menu.MenuItem id="vc-chordline-bans" label="Bans" action={openBansModal} />
            </>
        );
    },

    contextMenus: {
        "user-context": UserContextMenuPatch,
        "message": MessageContextMenuPatch
    },

    flux: {
        // Also fires when switching Discord accounts
        CONNECTION_OPEN() {
            refreshStaffIdentity();
            checkBan();
        }
    },

    /** For trying out the ban screen from the console: shows it with example data for a few seconds */
    previewBanScreen() {
        showBanScreen({ reason: "Example ban (preview)", expires_at: new Date(Date.now() + 26 * 3600_000 + 754_000).toISOString() }, hideBanScreen);
        setTimeout(() => checkBan(), 8000);
    },

    start() {
        refreshStaffIdentity();
        checkBan();
        clearInterval(banCheckTimer);
        banCheckTimer = setInterval(checkBan, BAN_CHECK_INTERVAL);
    },

    stop() {
        clearInterval(banCheckTimer);
        hideBanScreen();
    }
});
