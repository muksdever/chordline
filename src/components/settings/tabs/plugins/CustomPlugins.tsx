/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { checkCustomPluginSyntax, deleteCustomPlugin, exportCustomPlugin, getCustomPlugins, getCustomPluginSource, onCustomPluginsChange, parseCustomPluginFile, saveCustomPlugin, validateCustomPluginName } from "@api/CustomPlugins";
import { CustomPluginSource } from "@api/Settings";
import { Button } from "@components/Button";
import { HeadingTertiary } from "@components/Heading";
import { PencilIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { copyWithToast } from "@utils/discord";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { ConfirmModal, Forms, Modal, openModal, React, showToast, TextInput, useEffect, useReducer, useRef, useState } from "@webpack/common";

import { cl } from ".";
import { PluginCard } from "./PluginCard";

type RestartCallback = (name: string, key: string) => void;

const TEMPLATE = `// Use Vencord.* (Webpack, Api, Util, ...) inside start() and stop().
return {
    // Adds a /hello command to every chat
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "hello",
        description: "Say hello from Chordline",
        execute: () => ({ content: "Hello from Chordline! 👋" })
    }],

    start() {
        console.log("My plugin started!");
    },

    stop() {
        console.log("My plugin stopped!");
    }
};
`;

interface EditorProps extends RenderModalProps {
    /** The saved plugin being edited, if any */
    existing?: CustomPluginSource;
    /** Prefilled values for a new plugin, e.g. from an imported file */
    initial?: CustomPluginSource;
    onRestartNeeded: RestartCallback;
}

function CustomPluginEditor({ existing, initial, onRestartNeeded, ...modalProps }: EditorProps) {
    const start = existing ?? initial;
    const [name, setName] = useState(start?.name ?? "");
    const [description, setDescription] = useState(start?.description ?? "");
    const [code, setCode] = useState(start?.code ?? TEMPLATE);
    const [error, setError] = useState<string | null>(null);

    function save() {
        const trimmedName = name.trim();
        const nameError = validateCustomPluginName(trimmedName, existing?.name);
        if (nameError) return setError(nameError);

        try {
            checkCustomPluginSyntax(code);
        } catch (e) {
            return setError("Your code has a syntax error: " + (e instanceof Error ? e.message : String(e)));
        }

        const restartNeeded = saveCustomPlugin({ name: trimmedName, description: description.trim(), code }, existing?.name);
        if (restartNeeded) onRestartNeeded(trimmedName, "code");

        showToast({ text: `Saved ${trimmedName}`, variant: "success", position: "bottom" });
        modalProps.onClose();
    }

    function remove() {
        if (!existing) return;
        openModal(props => (
            <ConfirmModal
                {...props}
                title={`Delete ${existing.name}?`}
                confirmText="Delete"
                onConfirm={() => {
                    if (deleteCustomPlugin(existing.name)) onRestartNeeded(existing.name, "deleted");
                    modalProps.onClose();
                }}
            >
                <Paragraph>This can't be undone. Copy it first if you want to keep a backup.</Paragraph>
            </ConfirmModal>
        ));
    }

    // Pasting a shared plugin (from "Copy to Share") fills in its name and description
    function onCodeChange(value: string) {
        if (!value.startsWith("// @name ")) return setCode(value);

        const parsed = parseCustomPluginFile(value, name);
        if (!name.trim()) setName(parsed.name);
        if (!description.trim()) setDescription(parsed.description);
        setCode(parsed.code);
    }

    // Make Tab indent instead of moving focus out of the editor
    function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key !== "Tab") return;
        e.preventDefault();

        const textarea = e.currentTarget;
        const { selectionStart, selectionEnd } = textarea;
        setCode(code.slice(0, selectionStart) + "    " + code.slice(selectionEnd));
        requestAnimationFrame(() => textarea.selectionStart = textarea.selectionEnd = selectionStart + 4);
    }

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={existing ? `Edit ${existing.name}` : "Create Plugin"}
            subtitle="Plugins run inside Discord with full access to your account. Only add code you wrote yourself or got from someone you trust."
            notice={error ? { message: error, type: "critical" } : undefined}
            actions={[
                { text: "Save", variant: "primary", onClick: save },
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
            ]}
        >
            <Forms.FormTitle tag="h5">Name</Forms.FormTitle>
            <TextInput value={name} onChange={setName} placeholder="MyCoolPlugin" />

            <Forms.FormTitle tag="h5" className={Margins.top16}>Description</Forms.FormTitle>
            <TextInput value={description} onChange={setDescription} placeholder="What does it do?" />

            <Forms.FormTitle tag="h5" className={Margins.top16}>Code</Forms.FormTitle>
            <textarea
                className={cl("custom-editor")}
                value={code}
                onChange={e => onCodeChange(e.currentTarget.value)}
                onKeyDown={onKeyDown}
                spellCheck={false}
            />

            <div className={classes(cl("custom-actions"), Margins.top8, Margins.bottom16)}>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => copyWithToast(exportCustomPlugin({ name: name.trim(), description: description.trim(), code }), "Copied! Send it to a friend so they can import it.")}
                >
                    Copy to Share
                </Button>
                {existing && (
                    <Button variant="dangerSecondary" size="small" onClick={remove}>
                        Delete Plugin
                    </Button>
                )}
            </div>
        </Modal>
    );
}

function openEditor(onRestartNeeded: RestartCallback, existing?: CustomPluginSource, initial?: CustomPluginSource) {
    openModal(props => <CustomPluginEditor {...props} existing={existing} initial={initial} onRestartNeeded={onRestartNeeded} />);
}

export function CustomPluginsSection({ onRestartNeeded }: { onRestartNeeded: RestartCallback; }) {
    const [, forceUpdate] = useReducer(x => x + 1, 0);
    useEffect(() => onCustomPluginsChange(forceUpdate), []);

    const fileInput = useRef<HTMLInputElement>(null);
    const plugins = getCustomPlugins().sort((a, b) => a.name.localeCompare(b.name));

    async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file) return;

        const source = parseCustomPluginFile(await file.text(), file.name.replace(/\.[^.]+$/, ""));
        // Open the editor instead of saving right away, so the code can be reviewed first
        openEditor(onRestartNeeded, undefined, source);
    }

    return (
        <section className={Margins.top20}>
            <HeadingTertiary className={Margins.bottom8}>Your Plugins</HeadingTertiary>
            <Paragraph className={Margins.bottom8}>
                Make your own plugins right here, or import ones your friends send you.
            </Paragraph>

            <div className={classes(cl("custom-actions"), Margins.bottom16)}>
                <Button size="small" onClick={() => openEditor(onRestartNeeded)}>Create Plugin</Button>
                <Button variant="secondary" size="small" onClick={() => fileInput.current?.click()}>Import from File</Button>
                <input ref={fileInput} type="file" accept=".js,.txt" style={{ display: "none" }} onChange={importFile} />
            </div>

            {plugins.length > 0 && (
                <div className={cl("grid")}>
                    {plugins.map(p => (
                        <PluginCard
                            key={p.name}
                            plugin={p}
                            disabled={false}
                            onRestartNeeded={onRestartNeeded}
                            infoButton={
                                <button
                                    onClick={() => openEditor(onRestartNeeded, getCustomPluginSource(p.name))}
                                    className={cl("info-button")}
                                    aria-label={`Edit ${p.name}`}
                                >
                                    <PencilIcon className={cl("info-icon")} />
                                </button>
                            }
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
