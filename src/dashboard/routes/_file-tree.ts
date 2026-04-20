// src/dashboard/routes/_file-tree.ts
//
// Shared helper: build a hierarchical tree from a flat list of workspace
// file records. Used by both the agent files route and the instance shared
// files route.

export interface FileTreeInputRow {
  filename: string;
  size: number;
  content_hash: string;
  updated_at: string;
}

export interface FileNode {
  type: "file";
  path: string;
  name: string;
  size: number;
  content_hash: string;
  updated_at: string;
}

export interface DirNode {
  type: "dir";
  path: string;
  name: string;
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

/**
 * Build a hierarchical tree from a flat list of file entries.
 * Directories are synthesized from the segments of each file's path.
 * Folders and files at each level are sorted alphabetically; folders first.
 */
export function buildFileTree(files: FileTreeInputRow[]): TreeNode[] {
  interface DirAccumulator {
    dirs: Map<string, DirAccumulator>;
    files: FileNode[];
    path: string;
    name: string;
  }

  const root: DirAccumulator = { dirs: new Map(), files: [], path: "", name: "" };

  for (const file of files) {
    const segments = file.filename.split("/");
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]!;
      const dirPath = segments.slice(0, i + 1).join("/");
      let child = cursor.dirs.get(segment);
      if (!child) {
        child = { dirs: new Map(), files: [], path: dirPath, name: segment };
        cursor.dirs.set(segment, child);
      }
      cursor = child;
    }
    const leafName = segments[segments.length - 1]!;
    cursor.files.push({
      type: "file",
      path: file.filename,
      name: leafName,
      size: file.size,
      content_hash: file.content_hash,
      updated_at: file.updated_at,
    });
  }

  const toNodes = (acc: DirAccumulator): TreeNode[] => {
    const dirNodes: DirNode[] = Array.from(acc.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({
        type: "dir",
        path: d.path,
        name: d.name,
        children: toNodes(d),
      }));
    const fileNodes = acc.files.slice().sort((a, b) => a.name.localeCompare(b.name));
    return [...dirNodes, ...fileNodes];
  };

  return toNodes(root);
}
