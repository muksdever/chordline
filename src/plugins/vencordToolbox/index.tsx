/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ChordlineIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, useRef, useState } from "@webpack/common";
import type { PropsWithChildren } from "react";

import { renderPopout } from "./menu";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export const settings = definePluginSettings({
    showPluginMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show the plugins menu in the toolbox",
    }
});

function Icon({ isShown }: { isShown: boolean; }) {
    // Chordline logo; filled in while the toolbox is open
    return isShown
        ? (
            <svg viewBox="0 0 24 24" width={20} height={20} className="vc-toolbox-icon">
                <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="currentColor" />
                <path d="M5.5 13.5C7.6 13.5 8.2 8.3 10.3 8.3S13.2 15.7 15.3 15.7 17.3 10.5 18.5 10.5" fill="none" stroke="var(--background-base-lower, #000)" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx="18.5" cy="10.5" r="1.7" fill="var(--background-base-lower, #000)" />
            </svg>
        )
        : <ChordlineIcon width={20} height={20} className="vc-toolbox-icon" />;
}

function VencordPopoutButton() {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => renderPopout(() => setShow(false))}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className="vc-toolbox-btn"
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "Chordline Toolbox"}
                    icon={() => <Icon isShown={isShown} />}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

export default definePlugin({
    name: "VencordToolbox",
    description: "Adds a button to the titlebar that houses Chordline quick actions",
    tags: ["Utility", "Developers"],
    authors: [Devs.Ven, Devs.AutumnVN],
    // Chordline's staff and badge tools live in the toolbox, so it's always on
    required: true,

    settings,

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.TrailingWrapper,"
            }
        }
    ],

    TrailingWrapper({ children }: PropsWithChildren) {
        return (
            <>
                {children}
                <ErrorBoundary key="vc-toolbox" noop>
                    <VencordPopoutButton />
                </ErrorBoundary>
            </>
        );
    },
});
