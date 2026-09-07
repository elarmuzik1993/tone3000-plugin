import React, { useCallback, useRef, useState } from 'react';
import { ClipboardPaste, Copy, File, FolderClosed, PlusCircle, Save, Search } from './icons';
import { HELP } from './helpText';
import { rememberLibraryFolder } from '../hooks/useLibrary';
import type { TileMenuAnchor, TileMenuItem } from './TileMenu';
import type { ChainActions } from '../hooks/useChainActions';
import type { useToast } from './Toast';
import type { ChainSide } from '../types/chain';

/**
 * The right-click action sheet a block carries, in one place: the gallery
 * tiles and the expanded detail card show the same rows for the same block,
 * so a player who learns the menu on one knows it on the other.
 *
 * Two shapes, one for each thing a block can be:
 *  - `toneBlockMenuItems` for a loaded tone (copy it, replace it from the
 *    library or a local file, or file it *into* the library),
 *  - `insertSlotMenuItems` for an empty + slot (fill it from the clipboard,
 *    the library, or a local file).
 *
 * Everything here targets one block id, and every row that loads something
 * uses the same targeting rule as a file drop: an insert slot adds, a tone
 * block swaps in place.
 */

/** Right-click → element-local anchor for the action sheet (suppresses the
    OS context menu; macOS ctrl-click lands here too). Ctrl-click also fires
    a synthetic `click` after `contextmenu`; `shouldIgnoreClick` swallows
    that so a tile doesn't navigate away under the menu. */
export const useTileMenu = () => {
  const [menuAnchor, setMenuAnchor] = useState<TileMenuAnchor | null>(null);
  const suppressClickRef = useRef(false);
  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = true;
    // Viewport coords: TileMenu portals to body and positions with
    // position:fixed at these real-px coordinates.
    setMenuAnchor({ clientX: e.clientX, clientY: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  /** True when a click should be ignored (followed a contextmenu, is a
      modifier-click, or the menu is already open, in which case it closes). */
  const shouldIgnoreClick = useCallback(
    (e: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return true;
      }
      if (e.ctrlKey || e.metaKey) return true;
      if (menuAnchor) {
        closeMenu();
        return true;
      }
      return false;
    },
    [menuAnchor, closeMenu]
  );
  return { menuAnchor, openMenu, closeMenu, shouldIgnoreClick };
};

type Toast = ReturnType<typeof useToast>;

/** The native-picker rows (Load File / Load Folder). Local loading must not
    depend on drag-and-drop alone: Linux never delivers OS file drags to the
    embedded webview, so there these rows are the only way local files get
    in. */
const localLoadMenuItems = (
  targetBlockId: string,
  actions: ChainActions,
  toast: Toast
): TileMenuItem[] => {
  const pick = async (kind: 'file' | 'folder') => {
    const error = await actions.pickLocalFile(targetBlockId, kind);
    if (error) toast.show(error);
  };
  return [
    {
      label: 'Load File',
      icon: <File size={16} />,
      help: HELP.loadFileTile,
      onSelect: () => void pick('file'),
    },
    {
      label: 'Load Folder',
      icon: <FolderClosed size={16} />,
      help: HELP.loadFolderTile,
      onSelect: () => void pick('folder'),
    },
  ];
};

/** Rows past this many in one folder are left to the browser: a context
    menu listing a hundred captures is a wall, not a shortcut. */
const MAX_FOLDER_ROWS = 40;

/**
 * One library folder as menu rows, read from native when the row opens.
 * Subfolders open their own submenu, tones load into the target block on
 * the spot, and the last row hands off to the browser for anything the
 * menu can't do (renaming, removing, adding files).
 *
 * The whole point is that a tone you have filed is two gestures away:
 * right-click, pick it. Nothing here opens the browser takeover unless the
 * user asks for it.
 */
const libraryFolderItems = async (
  path: string,
  targetBlockId: string,
  actions: ChainActions,
  toast: Toast,
  openBrowser: () => void
): Promise<TileMenuItem[]> => {
  const browseRow = (label: string): TileMenuItem => ({
    label,
    icon: <Search size={16} />,
    help: HELP.libraryMenuBrowse,
    onSelect: () => {
      // Open the browser where the menu had got to, not back at the root.
      rememberLibraryFolder(path);
      openBrowser();
    },
  });

  const listing = await actions.listLibrary(path);
  if (!listing || listing.error) {
    return [
      {
        label: listing?.error ?? "Couldn't read the library",
        icon: null,
        help: HELP.libraryMenuTone,
        disabled: true,
      },
      browseRow('Browse Library'),
    ];
  }

  const load = (itemPath: string) => {
    void actions.loadFromLibrary(targetBlockId, itemPath).then((error) => {
      if (error) toast.show(error);
    });
  };

  const folders: TileMenuItem[] = listing.folders.map((folder) => ({
    label: folder.name,
    icon: <FolderClosed size={16} />,
    help: HELP.libraryMenuFolder,
    submenu: () => libraryFolderItems(folder.path, targetBlockId, actions, toast, openBrowser),
  }));

  const tones: TileMenuItem[] = listing.models.slice(0, MAX_FOLDER_ROWS).map((model) => ({
    label: model.name,
    icon: <File size={16} />,
    help: HELP.libraryMenuTone,
    onSelect: () => load(model.path),
  }));

  const rows: TileMenuItem[] = [];
  // A folder is a unit as well as a container: loading it makes one block
  // with a model per file. Offered inside the folder, above its contents.
  if (path !== '' && listing.models.length > 1) {
    rows.push({
      label: `Load all (${listing.models.length})`,
      icon: <PlusCircle size={16} />,
      help: HELP.libraryMenuLoadAll,
      onSelect: () => load(path),
    });
  }
  rows.push(...folders, ...tones);

  if (rows.length === 0) {
    rows.push({
      label: path === '' ? 'Library is empty' : 'Empty folder',
      icon: null,
      help: HELP.libraryMenuTone,
      disabled: true,
    });
  }
  rows.push(
    browseRow(listing.models.length > MAX_FOLDER_ROWS ? 'Show all in Library' : 'Browse Library')
  );
  return rows;
};

/** The library rows. The library is the local, always-available counterpart
    to browsing TONE3000: "From Library" opens the user's own folders right
    in the menu, and (on a tone block) "Save to Library" files the tone
    playing here so it's one gesture away next time. */
const libraryMenuItems = (
  blockId: string,
  actions: ChainActions,
  toast: Toast,
  openBrowser: () => void,
  save: (() => Promise<string>) | null
): TileMenuItem[] => [
  {
    label: 'From Library',
    icon: <FolderClosed size={16} />,
    help: HELP.fromLibraryTile,
    submenu: () => libraryFolderItems('', blockId, actions, toast, openBrowser),
  },
  ...(save
    ? [
        {
          label: 'Save to Library',
          icon: <Save size={16} />,
          help: HELP.saveToLibraryTile,
          onSelect: () => void save().then((message) => toast.show(message)),
        },
      ]
    : []),
];

/** A loaded tone block's rows: copy it, replace its tone (from the library
    or a local file, swapping in place), or file its tone into the library. */
export const toneBlockMenuItems = (
  blockId: string,
  actions: ChainActions,
  toast: Toast
): TileMenuItem[] => [
  {
    label: 'Copy',
    icon: <Copy size={16} />,
    help: HELP.copyBlock,
    onSelect: () => actions.copyBlock(blockId),
  },
  ...libraryMenuItems(
    blockId,
    actions,
    toast,
    () => actions.swapFromLibrary(blockId),
    () => actions.saveToLibrary(blockId)
  ),
  ...localLoadMenuItems(blockId, actions, toast),
];

/** An empty + slot's rows: fill it from the clipboard, the library, or a
    local file. `onPaste` is null when the block clipboard is empty. */
export const insertSlotMenuItems = (
  slotId: string,
  side: ChainSide,
  actions: ChainActions,
  toast: Toast,
  onPaste: (() => void) | null
): TileMenuItem[] => [
  {
    label: 'Paste',
    icon: <ClipboardPaste size={16} />,
    help: HELP.pasteBlock,
    disabled: onPaste == null,
    onSelect: () => onPaste?.(),
  },
  ...libraryMenuItems(
    slotId,
    actions,
    toast,
    () => void actions.addFromLibrary(side, slotId),
    null
  ),
  ...localLoadMenuItems(slotId, actions, toast),
];
