/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { CHORDLINE_LOGO_SVG, svgToDataUrl } from "@shared/chordlineLogo";
import { isSupabaseConfigured } from "@utils/chordlineSupabase";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, Menu, UserStore, useStateFromStores } from "@webpack/common";
import virtualMerge from "virtual-merge";

import { getProfileBanner, getProfileExtras, hasChordlineMark, loadAnnouncements, loadProfileExtras, syncMyChordlineMark } from "./data";
import { ChordlineMark, notifyNewAnnouncement, openAnnouncements, showWhatsNewIfUpdated } from "./windows";

export const settings = definePluginSettings({
    showThatIUseChordline: {
        type: OptionType.BOOLEAN,
        description: "Add an invisible mark to your About Me so other Chordline users see the Chordline icon next to your name (nobody else can see it)",
        default: true,
        onChange: (show: boolean) => syncMyChordlineMark(show)
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
/** Which account we last added the About Me mark for, so it's done once per account per session */
let markSyncedFor: string | null = null;

const UserProfileStore = findStoreLazy("UserProfileStore");

/** Whether this person's About Me has the invisible Chordline mark (only known once Discord has loaded their profile) */
const usesChordline = (userId: string) => hasChordlineMark(UserProfileStore.getUserProfile(userId)?.bio);

function Mark({ userId }: { userId?: string; }) {
    const uses = useStateFromStores([UserProfileStore], () => !!userId && usesChordline(userId));
    return uses && settings.store.showChordlineIcons ? <ChordlineMark /> : null;
}
const SafeMark = ErrorBoundary.wrap(Mark, { noop: true });

const UsesChordlineBadge: ProfileBadge = {
    id: "chordline_uses",
    description: "Uses Chordline",
    iconSrc: svgToDataUrl(CHORDLINE_LOGO_SVG),
    position: BadgePosition.END,
    props: { style: { borderRadius: "5px", transform: "scale(0.9)" } },
    shouldShow: ({ userId }) => settings.store.showChordlineIcons && usesChordline(userId)
};

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
    // A previous version showed "Playing Chordline"; make sure that status is gone
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", socketId: "ChordlineActivity", activity: null });

    const me = UserStore.getCurrentUser()?.id;
    if (me && markSyncedFor !== me) {
        markSyncedFor = me;
        syncMyChordlineMark(settings.store.showThatIUseChordline);
    }

    if (!isSupabaseConfigured()) return;
    loadProfileExtras();
    refreshAnnouncements();
}

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

    renderMessageDecoration: props => <SafeMark userId={props.message?.author?.id} />,
    renderMemberListDecorator: props => <SafeMark userId={props.user?.id} />,

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
        addProfileBadge(UsesChordlineBadge);
        startUp();

        timers.push(
            setInterval(refreshAnnouncements, MINUTE),
            setInterval(loadProfileExtras, 5 * MINUTE)
        );
        window.addEventListener("focus", onFocus);
    },

    stop() {
        removeProfileBadge(UsesChordlineBadge);
        timers.splice(0).forEach(clearInterval);
        window.removeEventListener("focus", onFocus);
    }
});
