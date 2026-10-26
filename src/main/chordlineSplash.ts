/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CHORDLINE_CYAN, CHORDLINE_LOGO_ANIMATED_SVG, CHORDLINE_PURPLE, svgToDataUrl } from "@shared/chordlineLogo";
import type { BrowserWindow } from "electron";

// Restyles Discord's startup splash ("Checking for updates...") as a Chordline loading screen.
// Only CSS is used because Discord re-renders the splash contents on every status change.
// Discord's own status text and update progress bars are kept.

export const isDiscordSplash = (preload: string | undefined) => !!preload?.endsWith("splashScreenPreload.js");

export const SPLASH_BACKGROUND = "#110f1c";

const SPLASH_CSS = `
html, body, #splash {
    background: radial-gradient(circle at 50% 30%, #2a2050 0%, ${SPLASH_BACKGROUND} 70%) !important;
}

/* Discord's animated logo -> Chordline's */
.splash-inner > img,
.splash-inner > video {
    display: none !important;
}

.splash-inner::before {
    content: "";
    display: block;
    width: 88px;
    height: 88px;
    margin: 0 auto 18px;
    border-radius: 22px;
    background: url("${svgToDataUrl(CHORDLINE_LOGO_ANIMATED_SVG)}") center / contain no-repeat;
    box-shadow: 0 10px 40px -6px ${CHORDLINE_PURPLE}aa, 0 0 0 1px #ffffff14;
    animation: chordline-float 3s ease-in-out infinite;
}

@keyframes chordline-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
}

.splash-inner .splash-text {
    top: 0 !important;
}

.splash-inner .splash-text::before {
    content: "Chordline";
    display: block;
    margin-bottom: 6px;
    color: #fff;
    font-family: var(--primary-font);
    font-size: 22px;
    font-weight: 500;
    letter-spacing: 0.3px;
}

.splash-inner .splash-text > span {
    color: #a9a3c7 !important;
}

.splash-inner .splash-text > span.splash-status {
    color: #d9d4f5 !important;
    font-size: 14px !important;
}

.progress .progress-bar {
    background-color: #ffffff17 !important;
}

.progress .progress-bar .complete {
    background: linear-gradient(90deg, ${CHORDLINE_PURPLE}, ${CHORDLINE_CYAN}) !important;
    transition: width 0.25s ease;
}
`;

export function applyChordlineSplash(win: BrowserWindow) {
    win.webContents.on("dom-ready", () => {
        win.webContents.insertCSS(SPLASH_CSS).catch(() => { });
    });
}
