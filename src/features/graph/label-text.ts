export const MAX_FILE_LABEL_CHARS = 24;
export const MAX_HUB_LABEL_CHARS = 20;
const ELLIPSIS = "…";
const MAX_EXTENSION_CHARS = 6;

/** Cuts a long name from the middle of its stem so the extension, which says what the file is, survives. */
export function truncateLabel(name: string, max: number = MAX_FILE_LABEL_CHARS): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= MAX_EXTENSION_CHARS ? name.slice(dot) : "";
  const stem = extension === "" ? name : name.slice(0, dot);
  const room = Math.max(max - extension.length - 1, 1);
  const head = Math.ceil(room * 0.65);
  const tail = room - head;
  return `${stem.slice(0, head)}${ELLIPSIS}${tail > 0 ? stem.slice(-tail) : ""}${extension}`;
}

export interface HubLabel {
  readonly name: string;
  readonly count: string;
}

/** `src/ 15`: the folder name, a slash, and how many files sit below it. The project root has no slash or count. */
export function hubLabel(name: string, files: number, isRoot: boolean): HubLabel {
  if (isRoot) return { name: truncateLabel(name, MAX_HUB_LABEL_CHARS), count: "" };
  return { name: `${truncateLabel(name, MAX_HUB_LABEL_CHARS)}/`, count: String(files) };
}

export function hubLabelText(label: HubLabel): string {
  return label.count === "" ? label.name : `${label.name} ${label.count}`;
}

export interface FolderActivity {
  readonly edited: number;
  readonly readOnly: number;
}

/** `3 edited · 3 read`, or null when the folder has not been touched. */
export function activityBadge(activity: FolderActivity): string | null {
  const parts: string[] = [];
  if (activity.edited > 0) parts.push(`${activity.edited} edited`);
  if (activity.readOnly > 0) parts.push(`${activity.readOnly} read`);
  return parts.length === 0 ? null : parts.join(" · ");
}
