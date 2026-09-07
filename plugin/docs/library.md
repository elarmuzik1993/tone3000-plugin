# The tone library: keeping the tones you actually use

`<app-data>/TONE3000/Library/` is the user's own folder tree of local
tones — `.nam` captures and IR `.wav` files, in whatever folders they make
— and the tone browser's first tab is a view of it. The point is that the
tones a player uses every day stop living on tone3000.com: file a tone
once and every later session loads it from disk, instantly, signed out,
offline.

It is deliberately a *store*, not a second kind of tone. A picked entry's
path goes to `loadLocalTonePath`, the same call a Load File pick makes, so
what lands in the chain is an ordinary local block (background load, model
cache, undo, duplication, presets, DAW state — all unchanged, see
[`local-models.md`](local-models.md)). Nothing downstream knows the tone
came from the library.

## The pieces

- `ToneLibrary` (`plugin/include/ToneLibrary.h`) is the file layer: list,
  create, rename, copy, remove, and the path resolution everything goes
  through. Pure files, like `PresetManager`; it knows nothing about tones,
  blocks or validation. Its root is swappable (`setLibraryRoot`), which is
  how the tests stay out of the real library and where a
  settings-configurable location would plug in.
- `ProcessorLibrary.cpp` is the half that needs the chain or the
  local-load pipeline: loading an entry, filing a live block, importing
  dropped bytes.
- `EditorWebViewSetup.cpp` exposes both over the bridge; the UI side is
  `useLibrary` + `LibraryBrowser`, rendered as the browser's Library tab.
- `blockMenu.tsx` holds the right-click rows a block carries. A gallery
  tile and the expanded detail card are two views of one block, so they
  build their menu from the same function rather than each listing rows of
  their own.

## Paths

Every path that crosses the bridge is root-relative, `/`-separated, with
`""` for the root. `ToneLibrary::resolve` refuses absolute paths, `..` and
empty segments and re-checks the result is inside the root, so a bug (or a
crafted call) in the webview can't reach the rest of the disk; the
`PathsThatEscapeTheLibraryAreRefused` test pins it. Names the user types
go through `sanitizeName`, which is why a folder called `Marshall/JCM`
becomes `MarshallJCM` instead of a nested folder.

## A folder is a unit

Loading a folder loads its files as **one multi-model block**, by the same
rules as dropping a folder on a tile (majority extension decides NAM vs
IR, natural name order, 300 files / 50 MB caps). So `Fender Twin/` with
eight captures becomes one tile with eight switchable models, and the
folder tree is both organization and a way to build multi-model tones by
hand. The listing's `models` count per folder is exactly what loading it
would add.

## Picking a tone without leaving the chain

The Library row of a block's right-click menu opens the folder tree *in
the menu*: folders cascade, a tone loads on click (into that slot, or
swapping that block in place), and a folder holding more than one tone
offers "Load all (N)" to take the whole thing as one multi-model block.
Two gestures from playing to played, with no takeover in between; the
browser is still one row away ("Browse Library", which opens on the
folder the menu had reached).

The rows are read from `listLibrary` when a row opens, one folder at a
time, so the menu costs nothing until it is used. A folder past 40 tones
lists the first 40 and hands the rest to the browser: a context menu
listing a hundred captures is a wall, not a shortcut.

## Getting tones in

Four ways, and the library shows whatever is in the folder regardless of
which was used:

- **Save to Library** on a block's right-click menu (its gallery tile or
  its expanded card) files the block's *active model*, bytes and all, from
  its model cache. This is the one that matters for catalog tones: the
  bytes are already in memory from the download, so filing them costs
  nothing, needs no account, and the copy outlives the session. Named
  `<tone> - <model>` (collapsed to one name when the model adds nothing),
  uniqued with ` (2)` rather than overwriting.
- **Drop** files or a folder on the browser. Bytes ride the bridge as
  base64 (the webview never exposes paths) and are validated exactly like
  a drop on a tile, so nothing unloadable lands in the library. A dropped
  folder keeps its name and becomes a library folder.
- **Add ▸ Add Files / Add Folder** opens the OS picker and copies the pick
  in. This is the route that works everywhere: Linux never delivers OS
  file drags to the embedded webview ([issue #22](https://github.com/tone-3000/tone3000-plugin/issues/22)),
  so there it is the only way in besides Save to Library.
- **The OS.** *Show Folder* opens the library in Finder/Explorer; files
  put there by hand show up on the next listing. Files copied from disk
  are only checked by extension — the loader validates them on load, the
  same as anything a user files in themselves.

Removals go to the OS trash where there is one. Blocks already in the
chain keep playing after a removal: they load from the content-addressed
local stash, and presets and DAW state embed their model bytes.

## Offline

The library is the reason the **+** button still does something useful
with the internet down: when the OS reports no network, `useToneLoadFlow`
opens the browser on the Library tab instead of raising the offline modal
(the catalog tabs are still there, and still say what's wrong if the user
switches to them).
