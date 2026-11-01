import type { Plugin } from "vite";

export const SAVE_ROUTE: string;
export function validateMapJson(json: unknown): string;
export function saveMapPlugin(options: { file: string }): Plugin;
