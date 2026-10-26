/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Chordline's logo: three faint "strings" with a wave running across them, ending in a note-like dot.
// Keep in sync with installer/logo.svg.

export const CHORDLINE_PURPLE = "#8b5cf6";
export const CHORDLINE_CYAN = "#22d3ee";

const WAVE = "M12 36C18 36 20 22 26 22S34 42 40 42 48 28 52 28";

export const CHORDLINE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CHORDLINE_PURPLE}"/><stop offset="1" stop-color="${CHORDLINE_CYAN}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>
<path d="M12 20H52M12 32H52M12 44H52" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
<path d="${WAVE}" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/>
<circle cx="52" cy="28" r="4.5" fill="#fff"/>
</svg>`;

/** The logo with the wave drawing itself in a loop, for loading screens */
export const CHORDLINE_LOGO_ANIMATED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CHORDLINE_PURPLE}"/><stop offset="1" stop-color="${CHORDLINE_CYAN}"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#g)"/>
<path d="M12 20H52M12 32H52M12 44H52" stroke="#fff" stroke-opacity=".22" stroke-width="2" stroke-linecap="round"/>
<path d="${WAVE}" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100">
<animate attributeName="stroke-dashoffset" values="100;0;0;-100" keyTimes="0;.45;.7;1" dur="2s" repeatCount="indefinite"/>
</path>
<circle cx="52" cy="28" r="4.5" fill="#fff" opacity="0">
<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;.4;.48;.75;.85" dur="2s" repeatCount="indefinite"/>
</circle>
</svg>`;

export const svgToDataUrl = (svg: string) => "data:image/svg+xml," + encodeURIComponent(svg.replace(/\n/g, ""));
