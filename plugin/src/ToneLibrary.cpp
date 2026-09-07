#include "ToneLibrary.h"

#include <algorithm>

namespace {

/** Same app-data root as PresetManager and the local-model stash. */
juce::File defaultLibraryRoot() {
  juce::File base = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);
#if JUCE_MAC
  base = base.getChildFile("Application Support");
#endif
  return base.getChildFile("TONE3000").getChildFile("Library");
}

juce::var errorResult(const juce::String& message) {
  juce::DynamicObject::Ptr obj = new juce::DynamicObject();
  obj->setProperty("error", message);
  return juce::var(obj.get());
}

/** Loadable files under `dir` (subfolders included), capped: the count is
    only ever rendered as a badge, and walking a folder someone pointed at
    their whole sample drive shouldn't stall the browser. */
int countModelFiles(const juce::File& dir) {
  constexpr int limit = 1000;
  int count = 0;
  for (const auto& file : dir.findChildFiles(juce::File::findFiles, true)) {
    if (ToneLibrary::isModelFile(file) && ++count >= limit)
      break;
  }
  return count;
}

/** Natural name order ("amp 2" before "amp 10"), the order the local-load
    pipeline puts a folder's models in. */
void sortByName(juce::Array<juce::File>& files) {
  std::sort(files.begin(), files.end(), [](const juce::File& a, const juce::File& b) {
    return a.getFileName().compareNatural(b.getFileName()) < 0;
  });
}

}  // namespace

ToneLibrary::ToneLibrary() : root(defaultLibraryRoot()) {}

ToneLibrary::ToneLibrary(const juce::File& rootDirectory) : root(rootDirectory) {}

bool ToneLibrary::isModelFile(const juce::File& file) {
  const juce::String extension = file.getFileExtension().toLowerCase();
  return extension == ".nam" || extension == ".wav";
}

juce::String ToneLibrary::kindOf(const juce::File& file) {
  return file.getFileExtension().equalsIgnoreCase(".nam") ? "nam" : "ir";
}

juce::String ToneLibrary::sanitizeName(const juce::String& name) {
  // createLegalFileName strips separators and the platform's reserved
  // characters; the rest guards against names that are legal but would make
  // an entry unreachable (leading dots hide it, trailing dots/spaces are
  // silently dropped by Windows).
  juce::String clean = juce::File::createLegalFileName(name).trim();
  while (clean.startsWithChar('.'))
    clean = clean.substring(1).trim();
  while (clean.endsWithChar('.'))
    clean = clean.dropLastCharacters(1).trim();
  return clean.substring(0, 120);
}

juce::File ToneLibrary::uniqueChild(const juce::File& dir, const juce::String& base,
                                    const juce::String& extension) {
  juce::File candidate = dir.getChildFile(base + extension);
  for (int n = 2; candidate.exists() && n < 1000; ++n)
    candidate = dir.getChildFile(base + " (" + juce::String(n) + ")" + extension);
  return candidate;
}

juce::File ToneLibrary::resolve(const juce::String& relativePath) const {
  const juce::String path = relativePath.replaceCharacter('\\', '/').trim();
  if (path.isEmpty())
    return root;
  // Rejected outright rather than sanitized: these only ever come from our
  // own UI, so anything shaped like an escape is a bug or an attack, not a
  // typo to be helpful about.
  if (juce::File::isAbsolutePath(path) || path.startsWithChar('/'))
    return {};

  juce::File file = root;
  for (const auto& segment : juce::StringArray::fromTokens(path, "/", {})) {
    if (segment.isEmpty() || segment == "." || segment == "..")
      return {};
    file = file.getChildFile(segment);
  }
  // Belt and braces: a segment that resolved through a symlink out of the
  // library still fails here.
  return file.isAChildOf(root) ? file : juce::File();
}

juce::String ToneLibrary::relativePathOf(const juce::File& file) const {
  if (file == root)
    return {};
  if (!file.isAChildOf(root))
    return {};
  return file.getRelativePathFrom(root).replaceCharacter('\\', '/');
}

juce::var ToneLibrary::list(const juce::String& relativePath) const {
  const juce::File dir = resolve(relativePath);
  if (dir == juce::File())
    return errorResult("That folder isn't in the library");
  // The root is created on first listing so the folder exists for the user
  // to drop files into from Finder/Explorer before the plugin ever writes.
  if (dir == root && !dir.isDirectory())
    dir.createDirectory();  // best effort; a failure falls through as "gone"
  if (!dir.isDirectory())
    return errorResult("That folder is gone");

  juce::Array<juce::File> childFolders =
      dir.findChildFiles(juce::File::findDirectories, false);
  juce::Array<juce::File> childFiles = dir.findChildFiles(juce::File::findFiles, false);
  sortByName(childFolders);
  sortByName(childFiles);

  juce::Array<juce::var> folders;
  for (const auto& folder : childFolders) {
    if (folder.isHidden())
      continue;
    juce::DynamicObject::Ptr entry = new juce::DynamicObject();
    entry->setProperty("name", folder.getFileName());
    entry->setProperty("path", relativePathOf(folder));
    entry->setProperty("models", countModelFiles(folder));
    folders.add(juce::var(entry.get()));
  }

  juce::Array<juce::var> models;
  for (const auto& file : childFiles) {
    if (!isModelFile(file) || file.isHidden())
      continue;
    juce::DynamicObject::Ptr entry = new juce::DynamicObject();
    entry->setProperty("name", file.getFileNameWithoutExtension());
    entry->setProperty("path", relativePathOf(file));
    entry->setProperty("kind", kindOf(file));
    entry->setProperty("size", file.getSize());
    entry->setProperty("modified", file.getLastModificationTime().toMilliseconds());
    models.add(juce::var(entry.get()));
  }

  juce::DynamicObject::Ptr result = new juce::DynamicObject();
  const juce::String path = relativePathOf(dir);
  result->setProperty("path", path);
  result->setProperty("name", dir == root ? juce::String("Library") : dir.getFileName());
  // Void (not "") at the root, so the UI can tell "no parent" from "the
  // parent is the root".
  result->setProperty("parent", dir == root ? juce::var()
                                            : juce::var(relativePathOf(dir.getParentDirectory())));
  result->setProperty("folders", folders);
  result->setProperty("models", models);
  return juce::var(result.get());
}

juce::var ToneLibrary::createFolder(const juce::String& parentPath,
                                    const juce::String& name) const {
  const juce::File parent = resolve(parentPath);
  if (parent == juce::File())
    return errorResult("That folder isn't in the library");

  const juce::String clean = sanitizeName(name);
  if (clean.isEmpty())
    return errorResult("Enter a folder name");

  const juce::File folder = parent.getChildFile(clean);
  if (folder.exists())
    return errorResult("A folder with that name already exists");
  if (!folder.createDirectory().wasOk())
    return errorResult("Couldn't create the folder");

  juce::DynamicObject::Ptr result = new juce::DynamicObject();
  result->setProperty("path", relativePathOf(folder));
  result->setProperty("name", folder.getFileName());
  return juce::var(result.get());
}

juce::var ToneLibrary::rename(const juce::String& relativePath,
                              const juce::String& newName) const {
  const juce::File file = resolve(relativePath);
  if (file == juce::File() || file == root)
    return errorResult("That item isn't in the library");
  if (!file.exists())
    return errorResult("That item is gone");

  const juce::String clean = sanitizeName(newName);
  if (clean.isEmpty())
    return errorResult("Enter a name");

  // Files keep their extension: it decides NAM vs IR downstream, so it's
  // ours to manage, not something a rename should be able to break.
  const juce::String extension = file.isDirectory() ? juce::String() : file.getFileExtension();
  const juce::File target = file.getParentDirectory().getChildFile(clean + extension);
  // Renaming to the same name is a no-op, not a collision (the browser
  // commits on blur as well as Enter).
  if (target == file) {
    juce::DynamicObject::Ptr unchanged = new juce::DynamicObject();
    unchanged->setProperty("path", relativePathOf(file));
    unchanged->setProperty("name", file.isDirectory() ? file.getFileName()
                                                      : file.getFileNameWithoutExtension());
    return juce::var(unchanged.get());
  }
  if (target.exists())
    return errorResult("A " + juce::String(file.isDirectory() ? "folder" : "file") +
                       " with that name already exists");
  if (!file.moveFileTo(target))
    return errorResult("Couldn't rename that");

  juce::DynamicObject::Ptr result = new juce::DynamicObject();
  result->setProperty("path", relativePathOf(target));
  result->setProperty("name", target.isDirectory() ? target.getFileName()
                                                   : target.getFileNameWithoutExtension());
  return juce::var(result.get());
}

bool ToneLibrary::remove(const juce::String& relativePath) const {
  const juce::File file = resolve(relativePath);
  if (file == juce::File() || file == root || !file.exists())
    return false;
  // The user's own captures: prefer the trash so a mis-click is recoverable
  // from the OS, and only really delete where there is no trash to move to.
  if (file.moveToTrash())
    return true;
  return file.isDirectory() ? file.deleteRecursively() : file.deleteFile();
}

juce::var ToneLibrary::importFrom(const juce::String& folderPath,
                                  const juce::File& source) const {
  const juce::File folder = resolve(folderPath);
  if (folder == juce::File())
    return errorResult("That folder isn't in the library");
  if (!folder.createDirectory().wasOk())
    return errorResult("Couldn't open the library folder");
  if (!source.exists())
    return errorResult("That file is gone");
  if (source.isAChildOf(root) || source == root)
    return errorResult("That's already in the library");

  if (!source.isDirectory()) {
    if (!isModelFile(source))
      return errorResult("Only .nam and .wav files are supported");
    const juce::File target =
        uniqueChild(folder, source.getFileNameWithoutExtension(), source.getFileExtension());
    if (!source.copyFileTo(target))
      return errorResult("Couldn't copy that file");

    juce::DynamicObject::Ptr result = new juce::DynamicObject();
    result->setProperty("path", relativePathOf(target));
    result->setProperty("name", target.getFileNameWithoutExtension());
    result->setProperty("copied", 1);
    return juce::var(result.get());
  }

  // A folder comes in whole (its own subfolders included), minus the files
  // the plugin can't load: the tree is the structure the user already made,
  // and flattening it here would throw that away.
  juce::Array<juce::File> files;
  for (const auto& file : source.findChildFiles(juce::File::findFiles, true))
    if (isModelFile(file))
      files.add(file);
  if (files.isEmpty())
    return errorResult("No .nam or .wav files in that folder");

  const juce::File target = uniqueChild(folder, source.getFileName(), {});
  int copied = 0;
  for (const auto& file : files) {
    const juce::File destination =
        target.getChildFile(file.getRelativePathFrom(source).replaceCharacter('\\', '/'));
    if (destination.getParentDirectory().createDirectory().wasOk() && file.copyFileTo(destination))
      ++copied;
  }
  if (copied == 0) {
    target.deleteRecursively();
    return errorResult("Couldn't copy those files");
  }

  juce::DynamicObject::Ptr result = new juce::DynamicObject();
  result->setProperty("path", relativePathOf(target));
  result->setProperty("name", target.getFileName());
  result->setProperty("copied", copied);
  return juce::var(result.get());
}

juce::var ToneLibrary::write(const juce::String& folderPath, const juce::String& name,
                             const void* data, size_t size) const {
  const juce::File folder = resolve(folderPath);
  if (folder == juce::File())
    return errorResult("That folder isn't in the library");
  if (!folder.createDirectory().wasOk())
    return errorResult("Couldn't open the library folder");

  const juce::String extension = name.fromLastOccurrenceOf(".", true, false).toLowerCase();
  const juce::String base = sanitizeName(name.upToLastOccurrenceOf(".", false, false));
  if (base.isEmpty() || (extension != ".nam" && extension != ".wav"))
    return errorResult("Only .nam and .wav files are supported");

  const juce::File target = uniqueChild(folder, base, extension);
  if (!target.replaceWithData(data, size))
    return errorResult("Couldn't write to the library folder");

  juce::DynamicObject::Ptr result = new juce::DynamicObject();
  result->setProperty("path", relativePathOf(target));
  result->setProperty("name", target.getFileNameWithoutExtension());
  return juce::var(result.get());
}
