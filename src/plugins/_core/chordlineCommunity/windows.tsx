/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { showNotice } from "@api/Notices";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { displayName, runWithToast, useUser } from "@plugins/_api/badges/BadgeManager";
import { CHORDLINE_LOGO_SVG, svgToDataUrl } from "@shared/chordlineLogo";
import { gitHash, gitRemote } from "@shared/vencordUserAgent";
import { useStaffRole } from "@utils/chordlineStaff";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, openModal, showToast, TextInput, Tooltip, useEffect, useReducer, useRef, UserStore, useState } from "@webpack/common";

import { Announcement, deleteAnnouncement, getAnnouncements, getProfileBanner, getProfileExtras, imageToBanner, onCommunityChange, postAnnouncement, saveMyProfileExtras } from "./data";

const cl = classNameFactory("vc-chordline-community-");
const LOGO_URL = svgToDataUrl(CHORDLINE_LOGO_SVG);

function useCommunityData() {
    const [, rerender] = useReducer(x => x + 1, 0);
    useEffect(() => onCommunityChange(rerender), []);
}

const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// --- "Uses Chordline" mark next to names ---

export function ChordlineMark() {
    return (
        <Tooltip text="Uses Chordline">
            {props => <img {...props} className={cl("mark")} src={LOGO_URL} alt="Uses Chordline" />}
        </Tooltip>
    );
}

// --- Announcements ---

const SEEN_KEY = "Chordline_seenAnnouncements";

function Author({ userId }: { userId: string; }) {
    const user = useUser(userId);
    return <>{user ? displayName(user) : "Chordline staff"}</>;
}

function AnnouncementCard({ announcement, canDelete }: { announcement: Announcement; canDelete: boolean; }) {
    return (
        <div className={cl("card")}>
            <div className={cl("row")}>
                <div className={cl("grow")}>
                    <div className={cl("title")}>{announcement.title}</div>
                    <div className={cl("meta")}>
                        <Author userId={announcement.created_by} /> · {formatDate(announcement.created_at)}
                    </div>
                </div>
                {canDelete && (
                    <Button variant="dangerSecondary" size="small" onClick={() => runWithToast(() => deleteAnnouncement(announcement.id), "Announcement deleted")}>
                        Delete
                    </Button>
                )}
            </div>
            <div className={cl("body")}>{announcement.body}</div>
        </div>
    );
}

function Composer() {
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [busy, setBusy] = useState(false);

    async function post() {
        if (!title.trim() || !body.trim()) return showToast({ text: "Add a title and a message", variant: "critical", position: "bottom" });
        setBusy(true);
        if (await runWithToast(() => postAnnouncement(title.trim(), body.trim()), "Announcement posted to everyone")) {
            setTitle("");
            setBody("");
        }
        setBusy(false);
    }

    return (
        <div className={classes(cl("card"), cl("composer"))}>
            <Forms.FormTitle tag="h5">Post an announcement</Forms.FormTitle>
            <TextInput value={title} onChange={setTitle} placeholder="Title" maxLength={100} />
            <textarea
                className={cl("textarea")}
                value={body}
                maxLength={2000}
                placeholder="What do you want everyone to know?"
                onChange={e => setBody(e.currentTarget.value)}
            />
            <div>
                <Button size="small" disabled={busy} onClick={post}>{busy ? "Posting..." : "Post to Everyone"}</Button>
            </div>
        </div>
    );
}

function AnnouncementsModal(props: RenderModalProps) {
    useCommunityData();
    const role = useStaffRole();
    const isStaff = role === "owner" || role === "dev";
    const list = getAnnouncements();

    useEffect(() => void markAnnouncementsSeen(), []);

    return (
        <Modal
            {...props}
            size="md"
            title="Announcements"
            subtitle="News from Chordline's staff"
            actions={[{ text: "Done", variant: "primary", onClick: props.onClose }]}
        >
            <div className={cl("content")}>
                {isStaff && <Composer />}
                {list.length
                    ? <div className={cl("list")}>{list.map(a => <AnnouncementCard key={a.id} announcement={a} canDelete={isStaff} />)}</div>
                    : <Paragraph>No announcements right now.</Paragraph>}
            </div>
        </Modal>
    );
}

export const openAnnouncements = () => openModal(props => <AnnouncementsModal {...props} />);

async function markAnnouncementsSeen() {
    await DataStore.set(SEEN_KEY, getAnnouncements().map(a => a.id));
}

let noticeShownFor: string | null = null;

/** Shows the newest unread announcement in Discord's top bar */
export async function notifyNewAnnouncement() {
    const newest = getAnnouncements()[0];
    if (!newest || noticeShownFor === newest.id) return;

    const seen = await DataStore.get<string[]>(SEEN_KEY);
    // First run: don't pop up old announcements, just remember them
    if (!seen) return markAnnouncementsSeen();
    if (seen.includes(newest.id)) return;

    noticeShownFor = newest.id;
    showNotice(`📣 Chordline: ${newest.title}`, "Read", openAnnouncements);
}

// --- What's new ---

const LAST_BUILD_KEY = "Chordline_lastSeenBuild";

interface Change {
    sha: string;
    title: string;
}

function WhatsNewModal({ changes, ...props }: RenderModalProps & { changes: Change[]; }) {
    return (
        <Modal
            {...props}
            size="md"
            title="What's new in Chordline"
            subtitle={`You're now on build ${gitHash}`}
            actions={[{ text: "Nice!", variant: "primary", onClick: props.onClose }]}
        >
            <div className={cl("content")}>
                <div className={cl("whatsnew-hero")}>
                    <img src={LOGO_URL} alt="" />
                    <div>Chordline just updated. Here's what changed:</div>
                </div>
                {changes.length
                    ? (
                        <ul className={cl("changes")}>
                            {changes.map(c => <li key={c.sha}>{c.title}</li>)}
                        </ul>
                    )
                    : <Paragraph>Small fixes and improvements.</Paragraph>}
            </div>
        </Modal>
    );
}

/** After an update, shows what changed since the build this person last used */
export async function showWhatsNewIfUpdated() {
    if (!gitHash || !gitRemote) return;

    const last = await DataStore.get<string>(LAST_BUILD_KEY);
    await DataStore.set(LAST_BUILD_KEY, gitHash);
    if (!last || last === gitHash) return;

    let changes: Change[] = [];
    try {
        const res = await fetch(`https://api.github.com/repos/${gitRemote}/compare/${last}...${gitHash}`);
        if (res.ok) {
            const data = await res.json();
            changes = data.commits
                .map((c: any) => ({ sha: c.sha, title: String(c.commit.message).split("\n")[0] }))
                .filter((c: Change) => !c.title.startsWith("Merge"))
                .reverse();
        }
    } catch { }

    openModal(props => <WhatsNewModal {...props} changes={changes} />);
}

// --- Profile extras, shown in the Chordline settings tab ---

const toHex = (color: number | null | undefined, fallback: string) =>
    color == null ? fallback : "#" + color.toString(16).padStart(6, "0");
const fromHex = (hex: string) => parseInt(hex.slice(1), 16);

export function ProfileExtrasSection() {
    useCommunityData();
    const me = UserStore.getCurrentUser();
    const saved = me ? getProfileExtras(me.id) : undefined;

    const [banner, setBanner] = useState<string | null | undefined>(undefined);
    const [primary, setPrimary] = useState<string | null>(null);
    const [accent, setAccent] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    // Show what's saved until the user changes something
    const shownBanner = banner === undefined ? (me && getProfileBanner(me.id)) ?? null : banner;
    const shownPrimary = primary ?? toHex(saved?.primary_color, "#8b5cf6");
    const shownAccent = accent ?? toHex(saved?.accent_color, "#22d3ee");
    const changed = banner !== undefined || primary != null || accent != null;

    async function pick(file: File | undefined) {
        if (file) await runWithToast(async () => setBanner(await imageToBanner(file)));
    }

    async function save() {
        setBusy(true);
        const ok = await runWithToast(
            () => saveMyProfileExtras(shownBanner, fromHex(shownPrimary), fromHex(shownAccent)),
            "Profile saved. Other Chordline users see it within a few minutes."
        );
        if (ok) {
            setBanner(undefined);
            setPrimary(null);
            setAccent(null);
        }
        setBusy(false);
    }

    async function clearAll() {
        setBusy(true);
        if (await runWithToast(() => saveMyProfileExtras(null, null, null), "Chordline profile removed")) {
            setBanner(undefined);
            setPrimary(null);
            setAccent(null);
        }
        setBusy(false);
    }

    return (
        <>
            <Paragraph className={Margins.bottom8}>
                Give yourself a profile banner and colors that everyone using Chordline sees, no Nitro needed.
                If you have Nitro, your real banner and colors show instead.
            </Paragraph>

            <div className={cl("profile-preview")} style={{ background: `linear-gradient(160deg, ${shownPrimary}, ${shownAccent})` }}>
                <button
                    className={cl("banner")}
                    style={shownBanner ? { backgroundImage: `url("${shownBanner}")` } : undefined}
                    onClick={() => fileInput.current?.click()}
                    title="Choose a banner image"
                >
                    {!shownBanner && "Click to add a banner"}
                </button>
                {me && <img className={cl("avatar")} src={me.getAvatarURL(undefined, 80)} alt="" />}
                <div className={cl("preview-name")}>{me ? displayName(me) : ""}</div>
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />

            <div className={classes(cl("row"), Margins.top8)}>
                <label className={cl("color")}>
                    <input type="color" value={shownPrimary} onChange={e => setPrimary(e.currentTarget.value)} />
                    Primary color
                </label>
                <label className={cl("color")}>
                    <input type="color" value={shownAccent} onChange={e => setAccent(e.currentTarget.value)} />
                    Accent color
                </label>
                {shownBanner && <Button variant="secondary" size="small" onClick={() => setBanner(null)}>Remove Banner</Button>}
            </div>

            <div className={classes(cl("row"), Margins.top8)}>
                <Button size="small" disabled={busy || !changed} onClick={save}>Save Profile</Button>
                {saved && <Button variant="dangerSecondary" size="small" disabled={busy} onClick={clearAll}>Reset</Button>}
            </div>
        </>
    );
}
