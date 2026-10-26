/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CHORDLINE_CYAN, CHORDLINE_LOGO_SVG, CHORDLINE_PURPLE, svgToDataUrl } from "@shared/chordlineLogo";

import { Ban, formatDuration } from "./api";

// A full-window screen shown to banned users that covers Discord until the ban ends.
// Plain DOM so it works no matter what state Discord's UI is in.

const ROOT_ID = "vc-chordline-ban-screen";

let countdownTimer: ReturnType<typeof setInterval> | undefined;
let onExpired: (() => void) | undefined;

const STYLE = `
#${ROOT_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: radial-gradient(circle at 50% 25%, #3a1630 0%, #110f1c 65%);
    color: #f2f0ff;
    font-family: var(--font-primary, "gg sans", "Segoe UI", sans-serif);
    text-align: center;
    -webkit-app-region: drag;
    user-select: none;
}
#${ROOT_ID} .card { max-width: 480px; }
#${ROOT_ID} img { width: 88px; height: 88px; filter: grayscale(0.6); opacity: 0.85; }
#${ROOT_ID} h1 { margin: 20px 0 6px; font-size: 30px; font-weight: 700; color: #ff6b6e; }
#${ROOT_ID} .reason { margin: 0 0 22px; color: #c9c3e6; font-size: 16px; line-height: 1.4; }
#${ROOT_ID} .label { color: #9690b8; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
#${ROOT_ID} .countdown {
    margin: 6px 0 26px;
    font-size: 34px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    background: linear-gradient(90deg, ${CHORDLINE_PURPLE}, ${CHORDLINE_CYAN});
    -webkit-background-clip: text;
    color: transparent;
}
#${ROOT_ID} .help {
    padding: 14px 18px;
    border: 1px solid #2a2547;
    border-radius: 12px;
    background: #1b182e;
    color: #a9a3c7;
    font-size: 14px;
    line-height: 1.5;
}
#${ROOT_ID} .help b { color: #f2f0ff; }
`;

function block(e: Event) {
    // Keep keyboard shortcuts and typing from reaching Discord underneath
    if (document.getElementById(ROOT_ID)) {
        e.stopImmediatePropagation();
        e.preventDefault();
    }
}

function render(ban: Pick<Ban, "reason" | "expires_at">) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        document.body.appendChild(root);
    }

    const expires = ban.expires_at ? new Date(ban.expires_at).getTime() : null;

    root.innerHTML = `<style>${STYLE}</style>
<div class="card">
    <img src="${svgToDataUrl(CHORDLINE_LOGO_SVG)}" alt="">
    <h1>Banned from Chordline</h1>
    <p class="reason"></p>
    <div class="label">${expires ? "Unbanned in" : "Ban length"}</div>
    <div class="countdown"></div>
    <div class="help">
        Chordline is blocking Discord while you're banned.<br>
        To use Discord again, <b>uninstall Chordline</b>: open <b>ChordlineInstaller.exe</b> and click <b>Uninstall</b>.
    </div>
</div>`;
    root.querySelector(".reason")!.textContent = `Reason: ${ban.reason}`;

    const countdown = root.querySelector<HTMLElement>(".countdown")!;
    const tick = () => {
        if (expires == null) {
            countdown.textContent = "Permanent";
            return;
        }
        const left = expires - Date.now();
        countdown.textContent = formatDuration(left);
        if (left <= 0) onExpired?.();
    };

    clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
}

export function showBanScreen(ban: Pick<Ban, "reason" | "expires_at">, whenExpired: () => void) {
    onExpired = whenExpired;
    render(ban);
    document.addEventListener("keydown", block, true);
    document.addEventListener("keyup", block, true);
}

export function hideBanScreen() {
    clearInterval(countdownTimer);
    onExpired = undefined;
    document.getElementById(ROOT_ID)?.remove();
    document.removeEventListener("keydown", block, true);
    document.removeEventListener("keyup", block, true);
}

export const isBanScreenShown = () => !!document.getElementById(ROOT_ID);
