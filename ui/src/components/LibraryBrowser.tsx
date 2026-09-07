import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  File,
  FolderClosed,
  FolderPlus,
  Pencil,
  PlusCircle,
  Trash2,
  Upload,
} from './icons';
import { useLibrary } from '../hooks/useLibrary';
import { useToast } from './Toast';
import { FormatBadge } from './FormatBadge';
import { TileMenu, type TileMenuAnchor } from './TileMenu';
import { BusyOverlay, LoadingDots } from './LoadingDots';
import { HELP, helpProps } from './helpText';
import type { LibraryFolder, LibraryModel } from '../types/library';
import {
  BORDER,
  BRAND_RED,
  DISABLED_OPACITY,
  GRAY,
  HIGHLIGHT,
  MUTED,
  SURFACE,
  WHITE,
  pillButtonStyle,
} from './theme';

/**
 * The tone browser's Library tab: the user's own folder tree of tones on
 * disk (<app data>/TONE3000/Library; see plugin/docs/library.md).
 *
 * It exists so the tones a player actually uses stop living on
 * tone3000.com: file a tone once, and every later session loads it from
 * disk, instantly, signed out, offline. The shape is deliberately a file
 * browser rather than a flat favourites list — players organize by rig,
 * band or session, and a folder here is also a *unit*: loading one loads
 * its files as a single multi-model block, so "Fender Twin/" with eight
 * captures becomes one tile with eight switchable models.
 *
 * Everything it shows is native's listing of one folder; every mutation
 * re-lists (see useLibrary). Files can also be put there by the OS —
 * Reveal opens the folder in Finder/Explorer — and the browser will show
 * whatever is in it next time.
 */

const ROW_RADIUS = 10;

/** Rows are hover-lit; their action buttons only appear on hover so a long
    list reads as names, not chrome. Focus counts as hover for keyboards. */
const rowStyles = `
  .library-row:hover { background-color: ${SURFACE}; }
  .library-row-actions { opacity: 0; transition: opacity 120ms ease; }
  .library-row:hover .library-row-actions,
  .library-row:focus-within .library-row-actions { opacity: 1; }
  .library-action:hover:not(:disabled) { background-color: ${HIGHLIGHT}; }
`;

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  backgroundColor: '#1C1C1E',
  border: BORDER,
  borderRadius: '8rem',
  color: WHITE,
  fontSize: '13rem',
  fontWeight: 400,
  padding: '6rem 10rem',
  outline: 'none',
};

const toolbarButtonStyle: React.CSSProperties = {
  ...pillButtonStyle,
  height: '30rem',
  padding: '0 14rem',
  gap: '8rem',
  fontSize: '13rem',
};

/** One of a row's trailing icon buttons (load / rename / remove). */
const RowAction: React.FC<{
  label: string;
  help: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, help, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    className="library-action"
    {...helpProps(help)}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26rem',
      height: '26rem',
      borderRadius: '6rem',
      border: 'none',
      background: 'transparent',
      color: WHITE,
      cursor: 'pointer',
      padding: 0,
      flexShrink: 0,
    }}
  >
    {children}
  </button>
);

/** Shared row frame: icon, name (or rename field), meta, actions. */
const Row: React.FC<{
  icon: React.ReactNode;
  name: string;
  meta?: React.ReactNode;
  busy?: boolean;
  renaming: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onClick: () => void;
  actions: React.ReactNode;
}> = ({ icon, name, meta, busy, renaming, onRename, onCancelRename, onClick, actions }) => {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name, renaming]);

  return (
    <div
      className="library-row"
      onClick={renaming ? undefined : onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '12rem',
        padding: '10rem 12rem',
        borderRadius: `${ROW_RADIUS}rem`,
        cursor: renaming ? 'default' : 'pointer',
        minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', color: MUTED, flexShrink: 0 }}>{icon}</span>

      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename(draft.trim());
            if (e.key === 'Escape') onCancelRename();
          }}
          // Committing on blur as well as Enter: the panel has no other
          // "done" affordance, and clicking away is what people do.
          onBlur={() => onRename(draft.trim())}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '14rem',
            fontWeight: 400,
            color: WHITE,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
      )}

      {!renaming && meta}
      {/* The actions' opacity lives in the stylesheet, not here: an inline
          style would outrank the :hover rule that reveals them. */}
      {!renaming && (
        <div className="library-row-actions" style={{ display: 'flex', gap: '2rem' }}>
          {actions}
        </div>
      )}
      {busy && <BusyOverlay align="center" />}
    </div>
  );
};

const metaTextStyle: React.CSSProperties = {
  fontSize: '13rem',
  fontWeight: 400,
  color: MUTED,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

interface LibraryBrowserProps {
  /**
   * Load a library entry into the chain (the pending insert/swap target the
   * browser was opened with). Resolves to a user-facing error message, or
   * null on success — after which the parent closes the browser.
   */
  onLoad: (itemPath: string) => Promise<string | null>;
}

export const LibraryBrowser: React.FC<LibraryBrowserProps> = ({ onLoad }) => {
  const toast = useToast();
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [dropArmed, setDropArmed] = useState(false);
  const [addMenu, setAddMenu] = useState<TileMenuAnchor | null>(null);
  const dragDepth = useRef(0);

  // Destructured so the callbacks below depend on the individual (stable)
  // actions rather than the hook's per-render object.
  const {
    listing,
    path,
    loading,
    error,
    open,
    refresh,
    rename,
    createFolder,
    remove,
    importDrop,
    importPick,
    reveal,
  } = useLibrary();

  // Any navigation ends whatever inline edit was open; the paths it refers
  // to aren't on screen any more.
  useEffect(() => {
    setNewFolder(null);
    setRenamingPath(null);
    setConfirmPath(null);
  }, [path]);

  const report = useCallback(
    (message: string | null) => {
      if (message) toast.show(message);
    },
    [toast]
  );

  const handleLoad = useCallback(
    async (itemPath: string) => {
      if (loadingPath !== null) return;
      setLoadingPath(itemPath);
      const failure = await onLoad(itemPath);
      setLoadingPath(null);
      if (failure) {
        toast.show(failure);
        // A tone that failed because it's gone from disk: re-list so the
        // browser stops showing it.
        void refresh();
      }
    },
    [loadingPath, onLoad, refresh, toast]
  );

  const handleRename = useCallback(
    async (itemPath: string, name: string) => {
      setRenamingPath(null);
      if (name) report(await rename(itemPath, name));
    },
    [rename, report]
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      setNewFolder(null);
      if (name) report(await createFolder(name));
    },
    [createFolder, report]
  );

  const handleRemove = useCallback(
    async (itemPath: string) => {
      setConfirmPath(null);
      report(await remove(itemPath));
    },
    [remove, report]
  );

  // Drops land in the folder on show. Depth counting: dragging across a row
  // fires dragleave on the panel, and a flickering overlay under the cursor
  // is worse than none.
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropArmed(false);
      const item = e.dataTransfer.items[0];
      if (!item) return;
      // Synchronous reads: the DataTransferItem goes inert once the handler
      // yields (the entry/file objects stay usable).
      const entry = item.webkitGetAsEntry();
      const file = entry?.isDirectory ? null : item.getAsFile();
      report(await importDrop(entry, file));
    },
    [importDrop, report]
  );

  const crumbs = (() => {
    const segments = path === '' ? [] : path.split('/');
    return [
      { label: 'Library', path: '' },
      ...segments.map((segment, index) => ({
        label: segment,
        path: segments.slice(0, index + 1).join('/'),
      })),
    ];
  })();

  const folderRow = (folder: LibraryFolder) => (
    <Row
      key={folder.path}
      icon={<FolderClosed size={18} />}
      name={folder.name}
      meta={
        <span style={metaTextStyle}>
          {folder.models} {folder.models === 1 ? 'tone' : 'tones'}
        </span>
      }
      busy={loadingPath === folder.path}
      renaming={renamingPath === folder.path}
      onRename={(name) => void handleRename(folder.path, name)}
      onCancelRename={() => setRenamingPath(null)}
      onClick={() => open(folder.path)}
      actions={
        <>
          {folder.models > 0 && (
            <RowAction
              label={`Load ${folder.name}`}
              help={HELP.libraryLoadFolder}
              onClick={() => void handleLoad(folder.path)}
            >
              <PlusCircle size={16} />
            </RowAction>
          )}
          <RowAction
            label={`Rename ${folder.name}`}
            help={HELP.libraryRename}
            onClick={() => setRenamingPath(folder.path)}
          >
            <Pencil size={15} />
          </RowAction>
          <RowAction
            label={`Remove ${folder.name}`}
            help={HELP.libraryRemove}
            onClick={() => setConfirmPath(folder.path)}
          >
            <Trash2 size={15} />
          </RowAction>
        </>
      }
    />
  );

  // No A2 mark on the badge: a local .nam's architecture isn't known until
  // it loads (native rejects non-A2 files then, with a toast).
  const modelRow = (model: LibraryModel) => (
    <Row
      key={model.path}
      icon={<File size={18} />}
      name={model.name}
      meta={<FormatBadge label={model.kind === 'nam' ? 'NAM' : 'IR'} />}
      busy={loadingPath === model.path}
      renaming={renamingPath === model.path}
      onRename={(name) => void handleRename(model.path, name)}
      onCancelRename={() => setRenamingPath(null)}
      onClick={() => void handleLoad(model.path)}
      actions={
        <>
          <RowAction
            label={`Rename ${model.name}`}
            help={HELP.libraryRename}
            onClick={() => setRenamingPath(model.path)}
          >
            <Pencil size={15} />
          </RowAction>
          <RowAction
            label={`Remove ${model.name}`}
            help={HELP.libraryRemove}
            onClick={() => setConfirmPath(model.path)}
          >
            <Trash2 size={15} />
          </RowAction>
        </>
      }
    />
  );

  const empty = (listing?.folders.length ?? 0) === 0 && (listing?.models.length ?? 0) === 0;

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current += 1;
          setDropArmed(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDropArmed(false);
      }}
      onDrop={(e) => void handleDrop(e)}
      style={{ position: 'relative' }}
    >
      <style>{rowStyles}</style>

      {/* Toolbar: where you are, and what you can do to this folder. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12rem',
          marginBottom: '12rem',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {crumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path}>
              {index > 0 && (
                <span style={{ display: 'flex', color: GRAY, flexShrink: 0 }}>
                  <ChevronRight size={14} />
                </span>
              )}
              <button
                type="button"
                onClick={() => open(crumb.path)}
                disabled={index === crumbs.length - 1}
                {...helpProps(HELP.libraryCrumb)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: index === 0 ? '0 4rem 0 0' : '0 4rem',
                  color: index === crumbs.length - 1 ? WHITE : MUTED,
                  fontSize: '14rem',
                  fontWeight: index === crumbs.length - 1 ? 600 : 400,
                  cursor: index === crumbs.length - 1 ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '220rem',
                }}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setNewFolder('')}
          {...helpProps(HELP.libraryNewFolder)}
          style={toolbarButtonStyle}
        >
          <FolderPlus size={15} />
          New Folder
        </button>
        {/* Add: the OS picker, in the same action-sheet style as the tile
            menus (and the only way in on Linux, where OS file drags never
            reach the webview). */}
        <button
          type="button"
          onClick={(e) => setAddMenu({ clientX: e.clientX, clientY: e.clientY })}
          {...helpProps(HELP.libraryAdd)}
          style={toolbarButtonStyle}
        >
          <Upload size={15} />
          Add
        </button>
        <button
          type="button"
          onClick={() => void reveal()}
          {...helpProps(HELP.libraryReveal)}
          style={toolbarButtonStyle}
        >
          <FolderClosed size={15} />
          Show Folder
        </button>
      </div>

      {newFolder !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12rem',
            padding: '10rem 12rem',
            borderRadius: `${ROW_RADIUS}rem`,
            backgroundColor: SURFACE,
            marginBottom: '4rem',
          }}
        >
          <span style={{ display: 'flex', color: MUTED }}>
            <FolderClosed size={18} />
          </span>
          <input
            autoFocus
            value={newFolder}
            placeholder="Folder name"
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreateFolder(newFolder.trim());
              if (e.key === 'Escape') setNewFolder(null);
            }}
            onBlur={() => void handleCreateFolder(newFolder.trim())}
            style={{ ...inputStyle, flex: 1, minWidth: 0 }}
          />
        </div>
      )}

      {error && (
        <div style={{ padding: '24rem 12rem', color: BRAND_RED, fontSize: '13rem' }}>{error}</div>
      )}

      {!error && loading && !listing && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64rem 0' }}>
          <LoadingDots />
        </div>
      )}

      {!error && listing && (
        <div style={{ opacity: loading ? DISABLED_OPACITY : 1 }}>
          {listing.folders.map(folderRow)}
          {listing.models.map(modelRow)}

          {empty && newFolder === null && (
            <div
              style={{
                padding: '56rem 24rem',
                textAlign: 'center',
                color: MUTED,
                fontSize: '13rem',
                fontWeight: 400,
                lineHeight: 1.6,
              }}
            >
              {path === '' ? 'Your library is empty.' : 'This folder is empty.'}
              <br />
              Drop .nam or .wav files here, use Add Files, or right-click a tone in the chain and
              pick Save to Library.
            </div>
          )}
        </div>
      )}

      {/* Remove confirmation: one click to arm, one to commit. Removals go
          to the OS trash, so this is a speed bump, not a vault door. */}
      {confirmPath !== null && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '12rem',
            marginTop: '12rem',
            padding: '12rem',
            borderRadius: '12rem',
            border: BORDER,
            backgroundColor: '#141416',
          }}
        >
          <span style={{ flex: 1, fontSize: '13rem', fontWeight: 400, color: WHITE }}>
            Remove “{confirmPath.split('/').pop()}” from the library?
          </span>
          <button
            type="button"
            onClick={() => setConfirmPath(null)}
            style={{ ...toolbarButtonStyle, padding: '0 16rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleRemove(confirmPath)}
            style={{ ...toolbarButtonStyle, padding: '0 16rem', borderColor: BRAND_RED }}
          >
            Remove
          </button>
        </div>
      )}

      {addMenu && (
        <TileMenu
          anchor={addMenu}
          onClose={() => setAddMenu(null)}
          items={[
            {
              label: 'Add Files',
              icon: <File size={16} />,
              help: HELP.libraryAddFiles,
              onSelect: () => void importPick('file').then(report),
            },
            {
              label: 'Add Folder',
              icon: <FolderClosed size={16} />,
              help: HELP.libraryAddFolder,
              onSelect: () => void importPick('folder').then(report),
            },
          ]}
        />
      )}

      {/* Drop affordance: the whole tab is the target, so the cue has to be
          the whole tab too. */}
      {dropArmed && (
        <div
          style={{
            position: 'absolute',
            inset: '-8rem',
            borderRadius: '14rem',
            border: `2rem dashed ${WHITE}`,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10rem',
            color: WHITE,
            fontSize: '14rem',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <Upload size={18} />
          Add to {crumbs[crumbs.length - 1].label}
        </div>
      )}
    </div>
  );
};
