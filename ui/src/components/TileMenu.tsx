import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from './icons';
import { helpProps } from './helpText';
import { useDismissable } from '../hooks/useDismissable';
import { BORDER, DISABLED_OPACITY, HIGHLIGHT, MUTED, WHITE } from './theme';

/**
 * Right-click action sheet for blocks, in the house floating-panel style
 * (see the faceplate's input-mode menu): #141416 panel, hairline border,
 * 14px radius, icon + label rows with the shared hover highlight.
 *
 * Portaled to document.body with position:fixed at the click's viewport
 * coords (numeric left/top = real px; the rem-denominated sizes scale with
 * the UI like everything else). Dismissed on outside press, Escape, or
 * picking a row.
 *
 * A row can open a submenu beside it (the Library row browses the user's
 * tone folders in place). Submenus are DOM children of their parent panel
 * even though they float free of it, so one outside-press check dismisses
 * the whole cascade and gestures inside any level stay contained.
 */

export interface TileMenuItem {
  /** Identity for React and for tracking which row's submenu is open.
      Defaults to the label, which is unique among the fixed rows but not
      among library entries — a folder `Amps` and a file `Amps.nam` list
      under the same label, so those rows pass their path. */
  id?: string;
  label: string;
  icon: React.ReactNode;
  /** One-line hint for the faceplate help readout. */
  help: string;
  disabled?: boolean;
  /** Picking the row. Omit for rows that only open a submenu. */
  onSelect?: () => void;
  /**
   * Rows to show beside this one. Called when the row is first opened (and
   * again after the menu closes), so a submenu can page its contents in
   * from native rather than loading everything up front.
   */
  submenu?: () => TileMenuItem[] | Promise<TileMenuItem[]>;
}

/** Click point in viewport (client) coordinates. */
export interface TileMenuAnchor {
  clientX: number;
  clientY: number;
}

/** Floor for the panel; it grows to fit its longest row (see `width`
    below), so a label never squeezes anything out. */
const MENU_MIN_WIDTH = 148;
const PANEL_PADDING = 6;
/** Visual-px nudge so the panel's top-left sits clearly past the cursor tip. */
const CURSOR_OFFSET = 6;
/** Gap between a panel and its submenu, and the margin both keep from the
    window edge. Real px, like every other viewport measurement here. */
const SUBMENU_GAP = 2;
const VIEWPORT_MARGIN = 8;
/** Pointer dwell before a submenu opens: long enough that sweeping down the
    menu past the Library row doesn't flash it open. */
const SUBMENU_HOVER_MS = 120;

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  // max-content, not a fixed width: rows are nowrap, and in a fixed panel a
  // label longer than the box shrinks the row's icon away instead of
  // overflowing (flex items shrink, text nodes don't).
  width: 'max-content',
  minWidth: `${MENU_MIN_WIDTH}rem`,
  maxWidth: '280rem',
  backgroundColor: '#141416',
  border: BORDER,
  borderRadius: '14rem',
  padding: `${PANEL_PADDING}rem`,
  zIndex: 1000,
  boxSizing: 'border-box',
  // A folder of tones can outgrow the window; the panel scrolls rather than
  // running off the bottom of it.
  overflowY: 'auto',
};

const rowStyles = `
  .tile-menu-item:hover:not(:disabled), .tile-menu-item.tile-menu-open {
    background-color: ${HIGHLIGHT};
  }
`;

/** Placeholder row while a submenu's contents are being read. */
const LOADING_ITEM: TileMenuItem = {
  label: 'Loading…',
  icon: null,
  help: '',
  disabled: true,
};

/** One panel's rows, plus whichever submenu is open beside them. */
const MenuPanel: React.FC<{
  items: TileMenuItem[];
  /** Where this panel wants to be; a submenu also passes the row it hangs
      off so it can flip to the other side when the window edge is near. */
  position: { left: number; top: number };
  flipAnchor?: { left: number; right: number };
  /** Close the whole cascade (a row was picked, or Escape). */
  closeAll: () => void;
}> = ({ items, position, flipAnchor, closeAll }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // Row count, not the array: it changes exactly when the panel's size can
  // (a submenu swapping "Loading…" for its rows), and it is stable across
  // the parent re-renders that rebuild the same menu.
  const itemCount = items.length;
  const [openRow, setOpenRow] = useState<{
    id: string;
    rect: DOMRect;
    items: TileMenuItem[] | null;
  } | null>(null);
  const hoverTimerRef = useRef<number | undefined>(undefined);
  // Set once measured; until then the panel renders hidden so it never
  // flashes at an unclamped spot.
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  // Clamp into the window: a submenu near the right edge flips to the other
  // side of its row, and any panel taller than the space below it rides up.
  const { left: wantLeft, top: wantTop } = position;
  const flipLeft = flipAnchor?.left;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    let left = wantLeft;
    let top = wantTop;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left =
        flipLeft !== undefined
          ? flipLeft - width - SUBMENU_GAP
          : window.innerWidth - VIEWPORT_MARGIN - width;
    }
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - VIEWPORT_MARGIN - height;
    }
    const next = {
      left: Math.max(VIEWPORT_MARGIN, left),
      top: Math.max(VIEWPORT_MARGIN, top),
    };
    // Settle: the deps below are primitives, but `items` arrives as a fresh
    // array on every parent render, so an unconditional setState here would
    // spin.
    setPlaced((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, [wantLeft, wantTop, flipLeft, itemCount]);

  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), []);

  const openSubmenu = useCallback((item: TileMenuItem, row: HTMLElement) => {
    if (!item.submenu) return;
    const id = item.id ?? item.label;
    const rect = row.getBoundingClientRect();
    setOpenRow({ id, rect, items: null });
    void Promise.resolve(item.submenu()).then((loaded) =>
      // Ignore a load that lost the race to another row.
      setOpenRow((current) => (current?.id === id ? { ...current, items: loaded } : current))
    );
  }, []);

  const handleRowEnter = useCallback(
    (item: TileMenuItem, row: HTMLElement) => {
      window.clearTimeout(hoverTimerRef.current);
      if (!item.submenu) {
        // Moving onto a plain row closes whatever was open beside this panel.
        setOpenRow(null);
        return;
      }
      if (openRow?.id === (item.id ?? item.label)) return;
      hoverTimerRef.current = window.setTimeout(() => openSubmenu(item, row), SUBMENU_HOVER_MS);
    },
    [openRow?.id, openSubmenu]
  );

  return (
    <div
      ref={panelRef}
      className="hide-scrollbar"
      // Keep every gesture inside the panel: clicks must not open the tile's
      // detail view, presses must not arm a drag under the menu.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        ...panelStyle,
        left: placed?.left ?? position.left,
        top: placed?.top ?? position.top,
        maxHeight: `calc(100vh - ${2 * VIEWPORT_MARGIN}px)`,
        visibility: placed ? 'visible' : 'hidden',
      }}
    >
      <style>{rowStyles}</style>
      {items.map((item) => {
        const id = item.id ?? item.label;
        const isOpen = openRow?.id === id;
        return (
          <button
            key={id}
            type="button"
            className={`tile-menu-item${isOpen ? ' tile-menu-open' : ''}`}
            disabled={item.disabled}
            {...helpProps(item.help)}
            onPointerEnter={(e) => handleRowEnter(item, e.currentTarget)}
            onClick={(e) => {
              // A submenu row toggles its panel; only a row that does
              // something closes the menu.
              if (item.submenu) {
                window.clearTimeout(hoverTimerRef.current);
                if (isOpen) setOpenRow(null);
                else openSubmenu(item, e.currentTarget);
                return;
              }
              closeAll();
              item.onSelect?.();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12rem',
              width: '100%',
              padding: '9rem 12rem',
              background: 'transparent',
              border: 'none',
              borderRadius: '8rem',
              color: item.disabled ? MUTED : WHITE,
              opacity: item.disabled ? DISABLED_OPACITY : 1,
              fontSize: '13rem',
              fontWeight: 400,
              textAlign: 'left',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ display: 'flex', flexShrink: 0 }}>{item.icon}</span>
            {/* Tone names can be long; the label ellipsizes instead of
                pushing the panel past its max width. */}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.label}
            </span>
            {item.submenu && (
              <span style={{ display: 'flex', flexShrink: 0, color: MUTED }}>
                <ChevronRight size={14} />
              </span>
            )}
          </button>
        );
      })}

      {/* Rendered inside this panel's DOM subtree (though it floats beside
          it), so the root's outside-press check covers the whole cascade. */}
      {openRow && (
        <MenuPanel
          // Keyed by the row: moving to a different one mounts a fresh
          // panel. Without it React reuses this instance and the new
          // submenu inherits the old one's open child and placement, which
          // strands that grandchild panel on screen.
          key={openRow.id}
          items={openRow.items ?? [LOADING_ITEM]}
          position={{
            left: openRow.rect.right + SUBMENU_GAP,
            top: openRow.rect.top - PANEL_PADDING,
          }}
          flipAnchor={{ left: openRow.rect.left, right: openRow.rect.right }}
          closeAll={closeAll}
        />
      )}
    </div>
  );
};

export const TileMenu: React.FC<{
  anchor: TileMenuAnchor;
  items: TileMenuItem[];
  onClose: () => void;
}> = ({ anchor, items, onClose }) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissable(true, rootRef, onClose);

  // A resize reflows the content under the fixed menu: just dismiss;
  // keeping it at the old client point would look wrong anyway.
  useEffect(() => {
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [onClose]);

  return createPortal(
    <div ref={rootRef}>
      <MenuPanel
        items={items}
        position={{ left: anchor.clientX + CURSOR_OFFSET, top: anchor.clientY + CURSOR_OFFSET }}
        closeAll={onClose}
      />
    </div>,
    document.body
  );
};
