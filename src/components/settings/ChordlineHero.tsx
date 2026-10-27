/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { openAnnouncements } from "@plugins/_core/chordlineCommunity/windows";
import { CHORDLINE_LOGO_SVG, svgToDataUrl } from "@shared/chordlineLogo";
import { gitHash, gitRemote } from "@shared/vencordUserAgent";
import { STAFF_ROLE_NAMES, useStaffRole } from "@utils/chordlineStaff";

const LOGO_URL = svgToDataUrl(CHORDLINE_LOGO_SVG);

/** Header at the top of the Chordline settings page */
export function ChordlineHero() {
    const role = useStaffRole();

    return (
        <div className="vc-chordline-hero">
            <img className="vc-chordline-hero-logo" src={LOGO_URL} alt="" />
            <div className="vc-chordline-hero-text">
                <div className="vc-chordline-hero-title">Chordline</div>
                <div className="vc-chordline-hero-subtitle">
                    Your Discord, your way{role ? ` · You're ${STAFF_ROLE_NAMES[role]}` : ""}
                </div>
                <span className="vc-chordline-hero-pill">build {gitHash}</span>
            </div>
            <div className="vc-chordline-hero-actions">
                <Button size="small" onClick={openAnnouncements}>Announcements</Button>
                <Button variant="secondary" size="small" onClick={() => VencordNative.native.openExternal("https://github.com/" + gitRemote)}>
                    Source Code
                </Button>
            </div>
        </div>
    );
}
