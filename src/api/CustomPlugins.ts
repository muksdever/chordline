/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CustomPluginSource, PlainSettings, Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { Plugin } from "@utils/types";

import Plugins, { PluginMeta } from "~plugins";

import { isPluginEnabled, pluginRequiresRestart, startPlugin, stopPlugin } from "./PluginManager";

// Custom plugins are written in the Plugins tab and stored in settings as source code.
// Their code is a function body that returns a plugin definition, e.g. `return { start() {}, stop() {} }`.
// They are registered into the same plugin list as built-in plugins, so toggling, patches and settings work the same.

const logger = new Logger("CustomPlugins", "#e78284");

const customNames = new Set<string>();
const listeners = new Set<() => void>();

export const CUSTOM_PLUGIN_NAME_REGEX = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;

export function isCustomPlugin(name: string) {
    return customNames.has(name);
}

export function getCustomPlugins() {
    return Object.values(Plugins).filter(p => customNames.has(p.name));
}

export function getCustomPluginSource(name: string): CustomPluginSource | undefined {
    return Settings.customPlugins[name];
}

export function onCustomPluginsChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function emitChange() {
    listeners.forEach(l => l());
}

/** Throws if the code has a syntax error. Does not run it. */
export function checkCustomPluginSyntax(code: string) {

    new Function(code);
}

function buildPlugin(source: CustomPluginSource): Plugin {
    let def: Record<string, any> = {};
    let error: string | undefined;

    try {

        const result = new Function(source.code)();
        if (result == null || typeof result !== "object")
            throw new Error("The code must return an object, like: return { start() {}, stop() {} }");
        def = result;
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        logger.error(`Failed to load custom plugin ${source.name}`, e);
    }

    return {
        ...def,
        name: source.name,
        description: error
            ? `⚠ This plugin has an error: ${error}`
            : source.description || "No description",
        authors: [{ name: "You", id: 0n }],
        started: false,
    } as Plugin;
}

function register(source: CustomPluginSource) {
    const plugin = buildPlugin(source);
    Plugins[source.name] = plugin;
    PluginMeta[source.name] = { folderName: "", userPlugin: true };
    customNames.add(source.name);
    return plugin;
}

function unregister(name: string) {
    delete Plugins[name];
    delete PluginMeta[name];
    customNames.delete(name);
}

export function loadCustomPlugins() {
    for (const source of Object.values(Settings.customPlugins)) {
        if (source.name in Plugins) {
            logger.warn(`Skipping custom plugin ${source.name} because a plugin with that name already exists`);
            continue;
        }
        register(source);
    }
}

/** Returns an error message if the name can't be used */
export function validateCustomPluginName(name: string, oldName?: string) {
    if (!CUSTOM_PLUGIN_NAME_REGEX.test(name))
        return "Names must start with a letter and only use letters, numbers, spaces, - and _ (max 40 characters).";
    if (name !== oldName && name in Plugins)
        return `A plugin called "${name}" already exists.`;
    return null;
}

/**
 * Creates or updates a custom plugin and restarts it if it was running.
 * @returns whether Discord needs to restart for the change to fully apply
 */
export function saveCustomPlugin(source: CustomPluginSource, oldName?: string) {
    const nameError = validateCustomPluginName(source.name, oldName);
    if (nameError) throw new Error(nameError);

    let restartNeeded = false;
    let wasEnabled = false;

    if (oldName && isCustomPlugin(oldName)) {
        const old = Plugins[oldName];
        wasEnabled = isPluginEnabled(oldName);

        // Patches can't be removed from already loaded Discord code
        if (wasEnabled && old.patches?.length) restartNeeded = true;
        if (old.started) stopPlugin(old);

        if (oldName !== source.name) {
            const oldSettings = PlainSettings.plugins[oldName];
            if (oldSettings) Settings.plugins[source.name] = { ...oldSettings };
            delete Settings.plugins[oldName];
            delete Settings.customPlugins[oldName];
        }

        unregister(oldName);
    }

    Settings.customPlugins[source.name] = source;
    const plugin = register(source);

    if (wasEnabled) {
        if (pluginRequiresRestart(plugin)) restartNeeded = true;
        else if (!startPlugin(plugin)) logger.error(`Failed to start custom plugin ${source.name}`);
    }

    emitChange();
    return restartNeeded;
}

/** @returns whether Discord needs to restart to fully remove the plugin */
export function deleteCustomPlugin(name: string) {
    if (!isCustomPlugin(name)) return false;

    const plugin = Plugins[name];
    const restartNeeded = isPluginEnabled(name) && !!plugin.patches?.length;
    if (plugin.started) stopPlugin(plugin);

    unregister(name);
    delete Settings.customPlugins[name];
    delete Settings.plugins[name];

    emitChange();
    return restartNeeded;
}

// Shareable file format: metadata as comments at the top, then the code
export function exportCustomPlugin({ name, description, code }: CustomPluginSource) {
    return `// @name ${name}\n// @description ${description}\n${code}`;
}

export function parseCustomPluginFile(text: string, fallbackName: string): CustomPluginSource {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const meta: Record<string, string> = {};

    while (lines.length) {
        const match = lines[0].match(/^\/\/\s*@(\w+)\s+(.*)$/);
        if (!match) break;
        meta[match[1]] = match[2].trim();
        lines.shift();
    }

    return {
        name: meta.name || fallbackName,
        description: meta.description || "",
        code: lines.join("\n")
    };
}
