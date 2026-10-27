/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { displayName, runWithToast, searchUsers, USER_ID_REGEX, UserLine, useUser } from "@plugins/_api/badges/BadgeManager";
import { STAFF_ROLE_NAMES, StaffRole, useStaffRole } from "@utils/chordlineStaff";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { RenderModalProps, User } from "@vencord/discord-types";
import { Forms, Modal, NavigationRouter, openModal, showToast, TextInput, useEffect, useMemo, useRef, UserStore, useState } from "@webpack/common";

import { addBan, Ban, BAN_DURATIONS, createReport, dismissReport, imageToProof, listBans, listReports, listStaff, removeBan, removeStaff, Report, setStaff, StaffMember, timeAgo } from "./api";

const cl = classNameFactory("vc-chordline-staff-");

const toast = (text: string, variant: "success" | "critical" = "critical") => showToast({ text, variant, position: "bottom" });

function Name({ userId }: { userId: string; }) {
    const user = useUser(userId);
    return <>{user ? displayName(user) : userId}</>;
}

function Person({ userId, children }: React.PropsWithChildren<{ userId: string; }>) {
    const user = useUser(userId);
    return <UserLine user={user} userId={userId}>{children}</UserLine>;
}

function RoleChip({ role }: { role: StaffRole; }) {
    return <span className={classes(cl("role"), cl(`role-${role}`))}>{STAFF_ROLE_NAMES[role]}</span>;
}

/** Search box that lets you pick a person by name or user ID */
function PersonPicker({ value, onChange }: { value: string | null; onChange(userId: string | null): void; }) {
    const [query, setQuery] = useState("");
    const trimmed = query.trim();
    const results = useMemo(() => searchUsers(trimmed), [trimmed]);
    const isId = USER_ID_REGEX.test(trimmed) && !results.some(u => u.id === trimmed);

    if (value) {
        return (
            <Person userId={value}>
                <Button variant="secondary" size="small" onClick={() => onChange(null)}>Change</Button>
            </Person>
        );
    }

    return (
        <>
            <TextInput value={query} onChange={setQuery} placeholder="Search by name, or paste a user ID" autoFocus />
            {trimmed && (
                <div className={classes(cl("list"), Margins.top8)}>
                    {results.map((u: User) => (
                        <UserLine key={u.id} user={u} userId={u.id}>
                            <Button size="small" onClick={() => onChange(u.id)}>Select</Button>
                        </UserLine>
                    ))}
                    {isId && <Person userId={trimmed}><Button size="small" onClick={() => onChange(trimmed)}>Select</Button></Person>}
                    {!results.length && !isId && <Paragraph>Nobody found. Try their username or paste their user ID.</Paragraph>}
                </div>
            )}
        </>
    );
}

function ReasonBox({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string; }) {
    return (
        <textarea
            className={cl("reason")}
            value={value}
            maxLength={1000}
            placeholder={placeholder}
            onChange={e => onChange(e.currentTarget.value)}
        />
    );
}

// --- Report (mods and up) ---

interface ReportTarget {
    userId: string;
    messageContent?: string;
    messageLink?: string;
}

/** Pick, drop or paste (Ctrl+V) a screenshot, with a preview */
function ProofPicker({ value, onChange, required }: { value: string | null; onChange(url: string | null): void; required: boolean; }) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);

    async function use(file: Blob | null | undefined) {
        if (!file) return;
        setLoading(true);
        await runWithToast(async () => onChange(await imageToProof(file)));
        setLoading(false);
    }

    // Paste a screenshot anywhere while the report window is open
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const item = [...e.clipboardData?.items ?? []].find(i => i.type.startsWith("image/"));
            if (!item) return;
            e.preventDefault();
            use(item.getAsFile());
        };
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, []);

    return (
        <>
            <Forms.FormTitle tag="h5" className={Margins.top16}>Proof {required ? "(required)" : "(optional)"}</Forms.FormTitle>
            {value
                ? (
                    <div className={cl("proof-preview")}>
                        <img src={value} alt="Proof" />
                        <button className={cl("proof-remove")} onClick={() => onChange(null)} aria-label="Remove image">×</button>
                    </div>
                )
                : (
                    <button
                        className={cl("proof-drop")}
                        onClick={() => fileInput.current?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); use(e.dataTransfer.files[0]); }}
                    >
                        {loading
                            ? "Adding image..."
                            : <>Click to add a screenshot, drop one here, or paste with <kbd>Ctrl</kbd>+<kbd>V</kbd></>}
                    </button>
                )}
            <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={e => { use(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}
            />
        </>
    );
}

function ReportModal({ target, ...props }: RenderModalProps & { target: ReportTarget; }) {
    const [reason, setReason] = useState("");
    const [proof, setProof] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Message reports already include the message, so the screenshot is only required for user reports
    const proofRequired = !target.messageLink;

    async function submit() {
        if (!reason.trim()) return toast("Write a reason for the report");
        if (proofRequired && !proof) return toast("Add a screenshot as proof");
        setBusy(true);
        const ok = await runWithToast(() => createReport({
            userId: target.userId,
            reason: reason.trim(),
            proof,
            messageContent: target.messageContent,
            messageLink: target.messageLink
        }), "Report sent to Chordline staff");
        setBusy(false);
        if (ok) props.onClose();
    }

    return (
        <Modal
            {...props}
            size="md"
            title={target.messageLink ? "Report Message" : "Report User"}
            subtitle="This goes to Chordline's owner and devs."
            actions={[
                { text: busy ? "Sending..." : "Send Report", variant: "critical-primary", onClick: submit, disabled: busy },
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
            ]}
        >
            <div className={cl("content")}>
                <Person userId={target.userId} />
                {target.messageContent && <blockquote className={classes(cl("quote"), Margins.top8)}>{target.messageContent}</blockquote>}
                <Forms.FormTitle tag="h5" className={Margins.top16}>Reason</Forms.FormTitle>
                <ReasonBox value={reason} onChange={setReason} placeholder="What did they do?" />
                <ProofPicker value={proof} onChange={setProof} required={proofRequired} />
            </div>
        </Modal>
    );
}

export const openReportModal = (target: ReportTarget) => openModal(props => <ReportModal {...props} target={target} />);

// --- Ban (devs and up) ---

function BanModal({ userId: initialUser, reason: initialReason, reportId, onDone, ...props }: RenderModalProps & {
    userId?: string;
    reason?: string;
    reportId?: string;
    onDone?(): void;
}) {
    const [userId, setUserId] = useState<string | null>(initialUser ?? null);
    const [reason, setReason] = useState(initialReason ?? "");
    const [duration, setDuration] = useState<number | null>(BAN_DURATIONS[1].minutes);
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (!userId) return toast("Pick who to ban");
        if (!reason.trim()) return toast("Write a reason for the ban");
        setBusy(true);
        const ok = await runWithToast(() => addBan(userId, reason.trim(), duration, reportId), "Banned from Chordline");
        setBusy(false);
        if (ok) {
            onDone?.();
            props.onClose();
        }
    }

    return (
        <Modal
            {...props}
            size="md"
            title="Ban from Chordline"
            subtitle="Their whole Discord is blocked by a ban screen until the ban ends or they uninstall Chordline."
            actions={[
                { text: busy ? "Banning..." : "Ban", variant: "critical-primary", onClick: submit, disabled: busy },
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
            ]}
        >
            <div className={cl("content")}>
                <Forms.FormTitle tag="h5">Who</Forms.FormTitle>
                <PersonPicker value={userId} onChange={setUserId} />

                <Forms.FormTitle tag="h5" className={Margins.top16}>Reason (they'll see this)</Forms.FormTitle>
                <ReasonBox value={reason} onChange={setReason} placeholder="Why are they being banned?" />

                <Forms.FormTitle tag="h5" className={Margins.top16}>How long</Forms.FormTitle>
                <div className={cl("chips")}>
                    {BAN_DURATIONS.map(d => (
                        <button
                            key={d.label}
                            className={classes(cl("chip"), duration === d.minutes && cl("chip-selected"))}
                            onClick={() => setDuration(d.minutes)}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

const openBanModal = (options: { userId?: string; reason?: string; reportId?: string; onDone?(): void; }) =>
    openModal(props => <BanModal {...props} {...options} />);

const LIST_REFRESH_INTERVAL = 15 * 1000;

/** Loads a list from the database, with a reload function */
function useList<T>(load: () => Promise<T[]>) {
    const [items, setItems] = useState<T[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reload = () => {
        load()
            .then(list => { setItems(list ?? []); setError(null); })
            .catch(e => setError(e instanceof Error ? e.message : String(e)));
    };

    // Load now, then keep the list up to date while the window is open
    useEffect(() => {
        reload();
        const timer = setInterval(reload, LIST_REFRESH_INTERVAL);
        return () => clearInterval(timer);
    }, []);

    return { items, setItems, error, reload };
}

function ListBody<T>({ items, error, empty, render }: { items: T[] | null; error: string | null; empty: string; render(item: T): React.ReactNode; }) {
    if (error) return <Paragraph className={cl("error")}>{error}</Paragraph>;
    if (!items) return <Paragraph>Loading...</Paragraph>;
    if (!items.length) return <Paragraph>{empty}</Paragraph>;
    return <div className={cl("list")}>{items.map(render)}</div>;
}

// --- Reports (devs and up) ---

function ProofViewer({ src, ...props }: RenderModalProps & { src: string; }) {
    return (
        <Modal {...props} size="xl" title="Proof" actions={[{ text: "Close", variant: "primary", onClick: props.onClose }]}>
            <div className={cl("proof-full")}>
                <img src={src} alt="Proof" />
            </div>
        </Modal>
    );
}

const openProofViewer = (src: string) => openModal(props => <ProofViewer {...props} src={src} />);

function ReportCard({ report, onHandled, onClose }: { report: Report; onHandled(): void; onClose(): void; }) {
    return (
        <div className={cl("card")}>
            <Person userId={report.reported_user_id}>
                <Button
                    variant="dangerPrimary"
                    size="small"
                    onClick={() => openBanModal({ userId: report.reported_user_id, reason: report.reason, reportId: report.id, onDone: onHandled })}
                >
                    Ban
                </Button>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => runWithToast(() => dismissReport(report.id), "Report dismissed").then(ok => ok && onHandled())}
                >
                    Dismiss
                </Button>
            </Person>

            <div className={cl("meta")}>
                Reported by <Name userId={report.reporter_id} /> · {timeAgo(report.created_at)}
            </div>
            <div className={cl("text")}>{report.reason}</div>

            {report.message_content && <blockquote className={cl("quote")}>{report.message_content}</blockquote>}
            {report.proof_image && (
                <button className={cl("proof-thumb")} onClick={() => openProofViewer(report.proof_image!)} title="Click to view full size">
                    <img src={report.proof_image} alt="Proof" />
                </button>
            )}
            {report.message_link && (
                <Button
                    variant="link"
                    size="small"
                    className={Margins.top8}
                    onClick={() => { onClose(); NavigationRouter.transitionTo(new URL(report.message_link!).pathname); }}
                >
                    Go to message
                </Button>
            )}
        </div>
    );
}

function ReportsModal(props: RenderModalProps) {
    const { items, error, reload } = useList(listReports);

    return (
        <Modal
            {...props}
            size="lg"
            title={`Reports${items ? ` (${items.length})` : ""}`}
            subtitle="Open reports from Chordline mods."
            actions={[
                { text: "Done", variant: "primary", onClick: props.onClose },
                { text: "Refresh", variant: "secondary", onClick: reload },
            ]}
        >
            <div className={cl("content")}>
                <ListBody
                    items={items}
                    error={error}
                    empty="No open reports. All clear!"
                    render={(r: Report) => (
                        <ReportCard
                            key={r.id}
                            report={r}
                            onClose={props.onClose}
                            onHandled={reload}
                        />
                    )}
                />
            </div>
        </Modal>
    );
}

export const openReportsModal = () => openModal(props => <ReportsModal {...props} />);

// --- Bans (devs and up) ---

function banLength(ban: Ban) {
    if (!ban.expires_at) return "Permanent";
    return `Ends ${new Date(ban.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
}

function BansModal(props: RenderModalProps) {
    const { items, setItems, error, reload } = useList(listBans);

    return (
        <Modal
            {...props}
            size="lg"
            title={`Bans${items ? ` (${items.length})` : ""}`}
            subtitle="People who are banned from Chordline right now."
            actions={[
                { text: "Done", variant: "primary", onClick: props.onClose },
                { text: "Add Ban", variant: "secondary", onClick: () => openBanModal({ onDone: reload }) },
            ]}
        >
            <div className={cl("content")}>
                <ListBody
                    items={items}
                    error={error}
                    empty="Nobody is banned."
                    render={(b: Ban) => (
                        <div key={b.user_id} className={cl("card")}>
                            <Person userId={b.user_id}>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => runWithToast(() => removeBan(b.user_id), "Ban removed").then(ok => ok && setItems(list => list?.filter(x => x.user_id !== b.user_id) ?? null))}
                                >
                                    Remove Ban
                                </Button>
                            </Person>
                            <div className={cl("meta")}>
                                {banLength(b)} · banned by <Name userId={b.banned_by} /> {timeAgo(b.created_at)}
                            </div>
                            <div className={cl("text")}>{b.reason}</div>
                        </div>
                    )}
                />
            </div>
        </Modal>
    );
}

export const openBansModal = () => openModal(props => <BansModal {...props} />);

// --- Staff (owner and devs) ---

function StaffModal(props: RenderModalProps) {
    const { items, error, reload } = useList(listStaff);
    const [newUser, setNewUser] = useState<string | null>(null);
    const [newRole, setNewRole] = useState<"dev" | "mod">("mod");
    const myId = UserStore.getCurrentUser()?.id;

    async function assign(userId: string, role: "dev" | "mod") {
        if (await runWithToast(() => setStaff(userId, role), `Made ${STAFF_ROLE_NAMES[role]}`)) {
            setNewUser(null);
            reload();
        }
    }

    return (
        <Modal
            {...props}
            size="lg"
            title="Chordline Staff"
            subtitle="Devs can do everything, including managing staff. Mods can report users and messages. Access goes by Discord user ID."
            actions={[{ text: "Done", variant: "primary", onClick: props.onClose }]}
        >
            <div className={cl("content")}>
                <Forms.FormTitle tag="h5">Add Staff</Forms.FormTitle>
                <PersonPicker value={newUser} onChange={setNewUser} />
                {newUser && (
                    <div className={classes(cl("row"), Margins.top8)}>
                        <div className={cl("chips")}>
                            {(["mod", "dev"] as const).map(r => (
                                <button key={r} className={classes(cl("chip"), newRole === r && cl("chip-selected"))} onClick={() => setNewRole(r)}>
                                    {STAFF_ROLE_NAMES[r]}
                                </button>
                            ))}
                        </div>
                        <Button size="small" onClick={() => assign(newUser, newRole)}>Add as {STAFF_ROLE_NAMES[newRole]}</Button>
                    </div>
                )}

                <Forms.FormTitle tag="h5" className={Margins.top20}>Team</Forms.FormTitle>
                <ListBody
                    items={items}
                    error={error}
                    empty="No staff yet."
                    render={(m: StaffMember) => (
                        <Person key={m.user_id} userId={m.user_id}>
                            <RoleChip role={m.role} />
                            {m.role !== "owner" && m.user_id !== myId && (
                                <>
                                    <Button variant="secondary" size="small" onClick={() => assign(m.user_id, m.role === "dev" ? "mod" : "dev")}>
                                        Make {m.role === "dev" ? "Mod" : "Dev"}
                                    </Button>
                                    <Button
                                        variant="dangerSecondary"
                                        size="small"
                                        onClick={() => runWithToast(() => removeStaff(m.user_id), "Removed from staff").then(ok => ok && reload())}
                                    >
                                        Remove
                                    </Button>
                                </>
                            )}
                        </Person>
                    )}
                />
            </div>
        </Modal>
    );
}

export const openStaffModal = () => openModal(props => <StaffModal {...props} />);

// --- Staff status, shown in the Chordline settings tab ---

export function StaffStatusSection() {
    const role = useStaffRole();

    return role
        ? <Paragraph>You're on Chordline staff as <RoleChip role={role} /></Paragraph>
        : <Paragraph>You're not on Chordline staff. The owner or a dev can add you by your Discord user ID.</Paragraph>;
}
