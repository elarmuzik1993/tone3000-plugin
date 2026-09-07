import { useCallback, useEffect, useRef, useState } from 'react';
import { useNativeFunction } from './useFunction';
import { MAX_LOCAL_FILE_BYTES, isModelFile, readDirectoryFiles, toPayload } from './localFiles';
import type { LibraryListing } from '../types/library';

/**
 * The tone library's UI side: one folder of the on-disk library at a time,
 * plus the actions that change it. Native owns the files (see
 * plugin/docs/library.md); this hook is a thin cursor over them that
 * re-lists after every mutation, the way the preset browser re-reads its
 * folder.
 *
 * Paths are root-relative and `/`-separated, with '' for the library root.
 * Native validates every one of them, so a stale path from a folder deleted
 * in Finder comes back as an error rather than a wrong listing; the hook
 * falls back to the root when that happens.
 */

/** The folder the browser was last in. Remembered across sessions so a
    player who keeps everything under "Live rig" lands there, and so
    "Save to Library" files tones where they were last browsing. */
const FOLDER_STORAGE_KEY = 't3k.libraryFolder';

/** The folder tile menus file tones into: wherever the browser was last
    left, the library root until it has been used. */
export const readLibraryFolder = (): string => {
  try {
    return localStorage.getItem(FOLDER_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Point the browser's Library tab at a folder before opening it (the tile
    menu's "Browse Library" row hands off the folder it was showing). */
export const rememberLibraryFolder = (path: string) => {
  try {
    localStorage.setItem(FOLDER_STORAGE_KEY, path);
  } catch {
    // Private-mode storage failures are not worth failing navigation over.
  }
};

/** Native's { error } | payload result, narrowed. */
const errorOf = (result: { error?: string } | null, fallback: string): string | null =>
  result === null ? fallback : (result.error ?? null);

export function useLibrary() {
  const listLibrary = useNativeFunction<LibraryListing>('listLibrary');
  const createFolderNative = useNativeFunction<{ path?: string; error?: string }>(
    'createLibraryFolder'
  );
  const renameNative = useNativeFunction<{ path?: string; error?: string }>('renameLibraryItem');
  const removeNative = useNativeFunction<boolean>('removeLibraryItem');
  const importFilesNative = useNativeFunction<{ copied?: number; error?: string }>(
    'importFilesToLibrary'
  );
  const importPickNative = useNativeFunction<{
    path?: string;
    error?: string;
    cancelled?: boolean;
  }>('importToLibrary');
  const revealNative = useNativeFunction<string>('revealLibraryFolder');

  const [path, setPath] = useState(readLibraryFolder);
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow listing landing after a newer one (fast clicks
  // through folders).
  const requestRef = useRef(0);

  const list = useCallback(
    async (target: string) => {
      const request = ++requestRef.current;
      setLoading(true);
      const result = await listLibrary(target);
      if (request !== requestRef.current) return;

      if (!result || result.error) {
        // The folder is gone (deleted in Finder since we were last here):
        // fall back to the root rather than stranding the browser.
        if (target !== '') {
          setPath('');
          rememberLibraryFolder('');
          void list('');
          return;
        }
        setListing(null);
        setError(result?.error ?? "Couldn't read the library folder");
        setLoading(false);
        return;
      }
      setListing(result);
      setError(null);
      setLoading(false);
    },
    [listLibrary]
  );

  useEffect(() => {
    void list(path);
  }, [list, path]);

  /** Navigate to a folder (the breadcrumb, a folder row, `''` for the root). */
  const open = useCallback((target: string) => {
    rememberLibraryFolder(target);
    setPath(target);
  }, []);

  const refresh = useCallback(() => list(path), [list, path]);

  const createFolder = useCallback(
    async (name: string): Promise<string | null> => {
      const result = await createFolderNative(path, name);
      await refresh();
      return errorOf(result, "Couldn't create the folder");
    },
    [createFolderNative, path, refresh]
  );

  const rename = useCallback(
    async (itemPath: string, newName: string): Promise<string | null> => {
      const result = await renameNative(itemPath, newName);
      await refresh();
      return errorOf(result, "Couldn't rename that");
    },
    [renameNative, refresh]
  );

  const remove = useCallback(
    async (itemPath: string): Promise<string | null> => {
      const removed = await removeNative(itemPath);
      await refresh();
      return removed ? null : "Couldn't remove that";
    },
    [removeNative, refresh]
  );

  /** The Import action: native opens the OS picker and copies the pick into
      the folder on show. Also the route that works on Linux, where OS file
      drags never reach the webview. */
  const importPick = useCallback(
    async (kind: 'file' | 'folder'): Promise<string | null> => {
      const result = await importPickNative(path, kind === 'folder');
      await refresh();
      if (result?.cancelled || result?.path) return null;
      return result?.error ?? "Couldn't add that to the library";
    },
    [importPickNative, path, refresh]
  );

  /** Files dropped on the browser. A dropped folder keeps its name: it
      becomes a library folder, which is the whole point of dropping one. */
  const importDrop = useCallback(
    async (entry: FileSystemEntry | null, file: File | null): Promise<string | null> => {
      try {
        if (entry?.isDirectory) {
          const all = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
          const files = all.filter((f) => isModelFile(f.name));
          if (files.length === 0) return 'No .nam or .wav files in the folder';
          if (files.some((f) => f.size > MAX_LOCAL_FILE_BYTES)) return 'A file is too large';

          const folder = await createFolderNative(path, entry.name);
          if (!folder?.path) return folder?.error ?? "Couldn't create the folder";
          const result = await importFilesNative(folder.path, await toPayload(files));
          await refresh();
          return errorOf(result, "Couldn't add those files");
        }

        if (!file) return "Couldn't read the dropped file";
        if (!isModelFile(file.name)) return 'Only .nam and .wav files are supported';
        if (file.size > MAX_LOCAL_FILE_BYTES) return 'File is too large';
        const result = await importFilesNative(path, await toPayload([file]));
        await refresh();
        return errorOf(result, "Couldn't add that file");
      } catch (err) {
        console.error('Library drop failed:', err);
        return "Couldn't read the dropped file";
      }
    },
    [createFolderNative, importFilesNative, path, refresh]
  );

  /** Open the current folder in Finder/Explorer. */
  const reveal = useCallback(async () => {
    await revealNative(path);
  }, [revealNative, path]);

  return {
    path,
    listing,
    loading,
    error,
    open,
    refresh,
    createFolder,
    rename,
    remove,
    importPick,
    importDrop,
    reveal,
  };
}
