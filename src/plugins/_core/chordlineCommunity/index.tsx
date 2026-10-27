/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { isSupabaseConfigured } from "@utils/chordlineSupabase";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";
import virtualMerge from "virtual-merge";

import { getProfileBanner, getProfileExtras, loadAnnouncements, loadChordlineUsers, loadProfileExtras, pingChordline, usesChordline } from "./data";
import { ChordlineMark, notifyNewAnnouncement, openAnnouncements, showWhatsNewIfUpdated } from "./windows";

export const settings = definePluginSettings({
    showThatIUseChordline: {
        type: OptionType.BOOLEAN,
        description: "Let other Chordline users see the Chordline icon next to your name",
        default: true,
        onChange: (show: boolean) => pingChordline(show)
    },
    showChordlineIcons: {
        type: OptionType.BOOLEAN,
        description: "Show the Chordline icon next to people who use Chordline",
        default: true
    },
    showProfileExtras: {
        type: OptionType.BOOLEAN,
        description: "Show other Chordline users' custom banners and profile colors",
        default: true
    }
});

const MINUTE = 60 * 1000;
const timers: ReturnType<typeof setInterval>[] = [];
let lastFocusRefresh = 0;
let whatsNewChecked = false;

async function refreshAnnouncements() {
    await loadAnnouncements();
    notifyNewAnnouncement();
}

function onFocus() {
    if (Date.now() - lastFocusRefresh < 15_000) return;
    lastFocusRefresh = Date.now();
    refreshAnnouncements();
}

function startUp() {
    if (!isSupabaseConfigured()) return;
    pingChordline(settings.store.showThatIUseChordline);
    loadChordlineUsers();
    loadProfileExtras();
    refreshAnnouncements();
}

const Mark = ErrorBoundary.wrap(({ userId }: { userId?: string; }) =>
    userId && settings.store.showChordlineIcons && usesChordline(userId) ? <ChordlineMark /> : null
, { noop: true });

export default definePlugin({
    name: "ChordlineCommunity",
    description: "Chordline's community features: the Chordline icon, profile banners and colors, announcements and What's new",
    authors: [{ name: "mukman", id: 1361146748449460375n }],
    required: true,
    settings,

    patches: [
        // Chordline profile banner (same spot USRBG uses)
        {
            find: ':"SHOULD_LOAD");',
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.getBannerUrl(arguments[0])||$&"
            }
        },
        // Chordline profile colors (same spot FakeProfileThemes uses)
        {
            find: "UserProfileStore",
            replacement: {
                match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                replace: "$self.addProfileColors($1)"
            }
        }
    ],

    getBannerUrl({ displayProfile }: any) {
        if (!settings.store.showProfileExtras || !displayProfile?.userId || displayProfile.banner) return;
        return getProfileBanner(displayProfile.userId);
    },

    addProfileColors(profile: any) {
        if (!profile || !settings.store.showProfileExtras || profile.themeColors) return profile;

        const extras = getProfileExtras(profile.userId);
        if (extras?.primary_color == null && extras?.accent_color == null) return profile;

        const primary = extras.primary_color ?? extras.accent_color!;
        const accent = extras.accent_color ?? extras.primary_color!;
        return virtualMerge(profile, { premiumType: 2, themeColors: [primary, accent] });
    },

    renderMessageDecoration: props => <Mark userId={props.message?.author?.id} />,
    renderMemberListDecorator: props => <Mark userId={props.user?.id} />,

    toolboxActions: () => (
        <Menu.MenuItem id="vc-chordline-announcements" label="Announcements" action={openAnnouncements} />
    ),

    flux: {
        // Also fires when switching Discord accounts
        CONNECTION_OPEN() {
            startUp();
            // Wait for Discord to finish loading before showing a popup
            if (!whatsNewChecked) {
                whatsNewChecked = true;
                setTimeout(showWhatsNewIfUpdated, 4000);
            }
        }
    },

    start() {
        startUp();

        timers.push(
            setInterval(refreshAnnouncements, MINUTE),
            setInterval(loadChordlineUsers, 5 * MINUTE),
            setInterval(loadProfileExtras, 5 * MINUTE),
            setInterval(() => pingChordline(settings.store.showThatIUseChordline), 30 * MINUTE)
        );
        window.addEventListener("focus", onFocus);
    },

    stop() {
        timers.splice(0).forEach(clearInterval);
        window.removeEventListener("focus", onFocus);
    }
});
