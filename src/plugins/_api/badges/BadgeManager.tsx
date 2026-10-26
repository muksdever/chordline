/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./badgeManager.css";

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { useStaffRole } from "@utils/chordlineStaff";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import { RenderModalProps, User } from "@vencord/discord-types";
import { ConfirmModal, Forms, Modal, openModal, RelationshipStore, showToast, TextInput, useEffect, useMemo, useReducer, useRef, UserStore, UserUtils, useState } from "@webpack/common";

import { BADGE_RARITIES, ChordlineBadge, createBadge, deleteBadge, getAllChordlineBadges, getBadgeHolders, giveBadge, imageToBadgeIcon, isBadgeBackendConfigured, loadChordlineBadges, onChordlineBadgesChange, takeBadge, updateBadge } from "./chordlineBadges";

const cl = classNameFactory("vc-chordline-badges-");

export const USER_ID_REGEX = /^\d{15,21}$/;

/** Runs an async action, showing a toast on success or failure. Returns whether it succeeded. */
export async function runWithToast(action: () => Promise<unknown>, success?: string) {
    try {
        await action();
        if (success) showToast({ text: success, variant: "success", position: "bottom" });
        return true;
    } catch (e) {
        showToast({ text: e instanceof Error ? e.message : String(e), variant: "critical", position: "bottom" });
        return false;
    }
}

function useBadges() {
    const [, rerender] = useReducer(x => x + 1, 0);
    useEffect(() => onChordlineBadgesChange(rerender), []);
    return getAllChordlineBadges();
}

/** Gets a user from Discord's cache, fetching them if they aren't loaded */
export function useUser(userId: string) {
    const [user] = useAwaiter<User | undefined>(
        async () => UserStore.getUser(userId) ?? await UserUtils.getUser(userId).catch(() => undefined),
        { fallbackValue: UserStore.getUser(userId), deps: [userId] }
    );
    return user;
}

export const displayName = (user: User) => user.globalName || user.username;

export function searchUsers(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const friends = new Set(RelationshipStore.getFriendIDs());
    return Object.values(UserStore.getUsers())
        .filter(u => !u.bot && (u.id === q || u.username.toLowerCase().includes(q) || u.globalName?.toLowerCase().includes(q)))
        .sort((a, b) => Number(friends.has(b.id)) - Number(friends.has(a.id)) || a.username.localeCompare(b.username))
        .slice(0, 8);
}


function BadgeForm({ initial, submitText, onSubmit, onCancel }: {
    initial?: ChordlineBadge;
    submitText: string;
    onSubmit(name: string, iconUrl: string, rarity: number): Promise<boolean>;
    onCancel?(): void;
}) {
    const [name, setName] = useState(initial?.name ?? "");
    const [iconUrl, setIconUrl] = useState(initial?.icon_url ?? "");
    const [rarity, setRarity] = useState(initial?.rarity ?? 1);
    const [busy, setBusy] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) await runWithToast(async () => setIconUrl(await imageToBadgeIcon(file)));
    }

    async function submit() {
        if (!name.trim()) return showToast({ text: "Give the badge a name", variant: "critical", position: "bottom" });
        if (!iconUrl) return showToast({ text: "Pick an image for the badge", variant: "critical", position: "bottom" });

        setBusy(true);
        const ok = await onSubmit(name.trim(), iconUrl, rarity);
        setBusy(false);
        if (ok && !initial) {
            setName("");
            setIconUrl("");
            setRarity(1);
        }
    }

    const isEmbedded = iconUrl.startsWith("data:");

    return (
        <div className={cl("form")}>
            <button className={cl("preview")} onClick={() => fileInput.current?.click()} title="Choose image">
                {iconUrl ? <img src={iconUrl} alt="" /> : <span>+</span>}
            </button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={pickImage} />

            <div className={cl("form-fields")}>
                <Forms.FormTitle tag="h5">Name (shown when hovering the badge)</Forms.FormTitle>
                <TextInput value={name} onChange={setName} placeholder="Chordline Tester" maxLength={64} />

                <Forms.FormTitle tag="h5" className={Margins.top8}>Image</Forms.FormTitle>
                <div className={cl("row")}>
                    <Button variant="secondary" size="small" onClick={() => fileInput.current?.click()}>
                        {iconUrl ? "Change Image" : "Choose Image"}
                    </Button>
                    <TextInput
                        value={isEmbedded ? "" : iconUrl}
                        onChange={setIconUrl}
                        placeholder={isEmbedded ? "Using the image you picked" : "...or paste an https:// image link"}
                        className={cl("grow")}
                    />
                </div>

                <Forms.FormTitle tag="h5" className={Margins.top8}>Rarity</Forms.FormTitle>
                <div className={cl("rarities")}>
                    {BADGE_RARITIES.map(r => (
                        <button
                            key={r.value}
                            className={classes(cl("rarity"), cl(`rarity-${r.value}`), rarity === r.value && cl("rarity-selected"))}
                            onClick={() => setRarity(r.value)}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>

                <div className={classes(cl("row"), Margins.top8)}>
                    <Button size="small" disabled={busy} onClick={submit}>{submitText}</Button>
                    {onCancel && <Button variant="secondary" size="small" onClick={onCancel}>Cancel</Button>}
                </div>
            </div>
        </div>
    );
}

export function UserLine({ user, userId, children }: React.PropsWithChildren<{ user?: User; userId: string; }>) {
    return (
        <div className={cl("user")}>
            {user
                ? <img src={user.getAvatarURL(undefined, 32)} alt="" />
                : <div className={cl("user-placeholder")} />}
            <div className={cl("grow")}>
                <div className={cl("name")}>{user ? displayName(user) : "Unknown user"}</div>
                <div className={cl("count")}>{user ? `@${user.username}` : userId}</div>
            </div>
            {children}
        </div>
    );
}

function Holder({ badge, userId }: { badge: ChordlineBadge; userId: string; }) {
    const user = useUser(userId);
    return (
        <UserLine user={user} userId={userId}>
            <Button variant="dangerSecondary" size="small" onClick={() => runWithToast(() => takeBadge(badge.id, userId), "Badge taken away")}>
                Remove
            </Button>
        </UserLine>
    );
}

function SearchResult({ badge, user, userId, has }: { badge: ChordlineBadge; user?: User; userId: string; has: boolean; }) {
    return (
        <UserLine user={user} userId={userId}>
            {has
                ? <span className={cl("count")}>Has it</span>
                : <Button size="small" onClick={() => runWithToast(() => giveBadge(badge.id, userId), `Gave ${badge.name} to ${user ? displayName(user) : userId}`)}>Give</Button>}
        </UserLine>
    );
}

function IdResult({ badge, userId, has }: { badge: ChordlineBadge; userId: string; has: boolean; }) {
    const user = useUser(userId);
    return <SearchResult badge={badge} user={user} userId={userId} has={has} />;
}

function PeoplePanel({ badge }: { badge: ChordlineBadge; }) {
    const [query, setQuery] = useState("");
    const holders = getBadgeHolders(badge.id);
    const holderSet = new Set(holders);

    const trimmed = query.trim();
    const results = useMemo(() => searchUsers(trimmed), [trimmed]);
    const isId = USER_ID_REGEX.test(trimmed) && !results.some(u => u.id === trimmed);

    return (
        <div className={Margins.top8}>
            <TextInput value={query} onChange={setQuery} placeholder="Search people by name, or paste a user ID" autoFocus />

            {trimmed && (
                <div className={classes(cl("users"), Margins.top8)}>
                    {results.map(u => <SearchResult key={u.id} badge={badge} user={u} userId={u.id} has={holderSet.has(u.id)} />)}
                    {isId && <IdResult badge={badge} userId={trimmed} has={holderSet.has(trimmed)} />}
                    {!results.length && !isId && (
                        <Paragraph>Nobody found. Try their username, or right-click them in Discord → Copy User ID and paste it here.</Paragraph>
                    )}
                </div>
            )}

            <Forms.FormTitle tag="h5" className={Margins.top16}>Has this badge ({holders.length})</Forms.FormTitle>
            <div className={cl("users")}>
                {holders.length
                    ? holders.map(id => <Holder key={id} badge={badge} userId={id} />)
                    : <Paragraph>Nobody yet. Search for someone above to give it to them.</Paragraph>}
            </div>
        </div>
    );
}

function BadgeRow({ badge }: { badge: ChordlineBadge; }) {
    const [mode, setMode] = useState<"closed" | "people" | "edit">("closed");
    const holderCount = getBadgeHolders(badge.id).length;

    function confirmDelete() {
        openModal(props => (
            <ConfirmModal
                {...props}
                title={`Delete ${badge.name}?`}
                confirmText="Delete"
                onConfirm={() => void runWithToast(() => deleteBadge(badge), `Deleted ${badge.name}`)}
            >
                <Paragraph>It will be removed from everyone who has it ({holderCount}).</Paragraph>
            </ConfirmModal>
        ));
    }

    if (mode === "edit") {
        return (
            <div className={cl("badge")}>
                <BadgeForm
                    initial={badge}
                    submitText="Save"
                    onCancel={() => setMode("closed")}
                    onSubmit={async (name, iconUrl, rarity) => {
                        const ok = await runWithToast(() => updateBadge(badge.id, name, iconUrl, rarity), "Badge saved");
                        if (ok) setMode("closed");
                        return ok;
                    }}
                />
            </div>
        );
    }

    return (
        <div className={cl("badge")}>
            <div className={cl("row")}>
                <img className={cl("icon")} src={badge.icon_url} alt="" />
                <div className={cl("grow")}>
                    <div className={cl("name")}>{badge.name}</div>
                    <div className={cl("count")}>
                        <span className={classes(cl("rarity-text"), cl(`rarity-${badge.rarity ?? 1}`))}>
                            {BADGE_RARITIES.find(r => r.value === badge.rarity)?.label ?? "Common"}
                        </span>
                        {" · "}{holderCount === 1 ? "1 person" : `${holderCount} people`}
                    </div>
                </div>
                <Button variant={mode === "people" ? "primary" : "secondary"} size="small" onClick={() => setMode(mode === "people" ? "closed" : "people")}>
                    Give / People
                </Button>
                <Button variant="secondary" size="small" onClick={() => setMode("edit")}>Edit</Button>
                <Button variant="dangerSecondary" size="small" onClick={confirmDelete}>Delete</Button>
            </div>

            {mode === "people" && <PeoplePanel badge={badge} />}
        </div>
    );
}

function AdminView() {
    const badges = useBadges();

    return (
        <>
            <Forms.FormTitle tag="h5">Create a Badge</Forms.FormTitle>
            <BadgeForm
                submitText="Create Badge"
                onSubmit={(name, iconUrl, rarity) => runWithToast(() => createBadge(name, iconUrl, rarity), `Created ${name}`)}
            />

            <Forms.FormTitle tag="h5" className={Margins.top20}>Your Badges ({badges.length})</Forms.FormTitle>
            <Paragraph className={Margins.bottom8}>
                Tip: you can also right-click anyone in Discord → Chordline Badges.
            </Paragraph>
            <div className={cl("list")}>
                {badges.length
                    ? badges.map(b => <BadgeRow key={b.id} badge={b} />)
                    : <Paragraph>No badges yet. Create your first one above!</Paragraph>}
            </div>
        </>
    );
}

function BadgeManagerModal(props: RenderModalProps) {
    const role = useStaffRole();

    useEffect(() => void loadChordlineBadges(), []);

    let body: React.ReactNode;
    if (!isBadgeBackendConfigured())
        body = <Paragraph>The badge database isn't set up. Add your Supabase URL and anon key in src/utils/chordlineSupabase.ts.</Paragraph>;
    else if (role !== "owner" && role !== "dev")
        body = <Paragraph>Only Chordline's owner and devs can manage badges.</Paragraph>;
    else
        body = <AdminView />;

    return (
        <Modal
            {...props}
            size="lg"
            title="Chordline Badges"
            subtitle="Make badges and give them to people. Everyone using Chordline sees them on profiles."
            actions={[{ text: "Done", variant: "primary", onClick: props.onClose }]}
        >
            <div className={cl("content")}>{body}</div>
        </Modal>
    );
}

export function openBadgeManager() {
    openModal(props => <BadgeManagerModal {...props} />);
}
