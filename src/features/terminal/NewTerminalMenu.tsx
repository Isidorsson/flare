import { Bot, ChevronDown, Pin, Plus } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";

import { anchorNameFor } from "@/shared/ui/anchor-name";
import { IconButton } from "@/shared/ui/IconButton";
import { Tooltip } from "@/shared/ui/Tooltip";

import { hasClaude, shellProfiles, type LaunchProfile } from "./launch-profiles";
import { loadedProfiles } from "./profiles-store";
import {
  openClaudeTerminal,
  openDefaultTerminal,
  openShellTerminal,
  selectDefaultShell,
  useTerminalProfiles,
} from "./use-terminal";

const ROW = "flex h-7 items-center gap-1 rounded pr-1 pl-2 hover:bg-surface-3";
const ROW_BUTTON = "flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-fg";

/** A split button: the plus opens the default shell, the chevron lists every shell and Claude Code. */
export function NewTerminalMenu() {
  const menuId = useId();
  const anchor = anchorNameFor("new-terminal-menu", menuId);
  const popover = useRef<HTMLDivElement>(null);
  const defaultShell = useTerminalProfiles(selectDefaultShell);
  const refresh = useTerminalProfiles((state) => state.refresh);

  const close = () => {
    popover.current?.hidePopover();
  };

  return (
    <div style={{ anchorName: anchor }} className="flex shrink-0 items-center">
      <IconButton
        icon={Plus}
        label="Open a new terminal"
        detail={defaultShell === null ? undefined : `Starts ${defaultShell.label}`}
        side="top"
        onClick={openDefaultTerminal}
      />
      <Tooltip content="Choose a shell or Claude Code" side="top">
        <button
          type="button"
          popoverTarget={menuId}
          aria-label="Choose a shell or Claude Code"
          className="inline-flex h-7 w-4 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </button>
      </Tooltip>
      <div
        id={menuId}
        ref={popover}
        popover="auto"
        aria-label="New terminal"
        onToggle={(event) => {
          if (event.newState === "open") void refresh();
        }}
        style={{ positionAnchor: anchor, positionArea: "top span-right" }}
        className="inset-auto m-0 mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-border-strong bg-surface-2 p-1 text-fg shadow-lg"
      >
        <ProfileMenuBody onClose={close} />
      </div>
    </div>
  );
}

function ProfileMenuBody({ onClose }: { onClose: () => void }) {
  const load = useTerminalProfiles((state) => state.load);
  const profiles = useTerminalProfiles(loadedProfiles);
  const defaultShell = useTerminalProfiles(selectDefaultShell);
  const setDefaultProfile = useTerminalProfiles((state) => state.setDefaultProfile);

  if (load.kind === "failed") return <MenuNote text={`Could not list shells: ${load.message}`} />;
  if (profiles.length === 0) return <MenuNote text="Looking for shells" />;

  return (
    <>
      <MenuSection title="Shells">
        {shellProfiles(profiles).map((profile) => (
          <ShellRow
            key={profile.id}
            profile={profile}
            isDefault={profile.id === defaultShell?.id}
            onOpen={() => {
              onClose();
              openShellTerminal(profile);
            }}
            onMakeDefault={() => {
              setDefaultProfile(profile.id);
            }}
          />
        ))}
      </MenuSection>
      <MenuSection title="Agent">
        <ClaudeRow
          installed={hasClaude(profiles)}
          onOpen={() => {
            onClose();
            openClaudeTerminal();
          }}
        />
      </MenuSection>
    </>
  );
}

interface ShellRowProps {
  profile: LaunchProfile;
  isDefault: boolean;
  onOpen: () => void;
  onMakeDefault: () => void;
}

function ShellRow({ profile, isDefault, onOpen, onMakeDefault }: ShellRowProps) {
  return (
    <li className={ROW}>
      <button type="button" onClick={onOpen} className={ROW_BUTTON}>
        <span className="min-w-0 flex-1 truncate">{profile.label}</span>
        {isDefault && <span className="shrink-0 text-[11px] text-fg-subtle">Default</span>}
      </button>
      {!isDefault && (
        <IconButton
          icon={Pin}
          label={`Make ${profile.label} the default`}
          detail="The plus button and new drawers start this shell"
          side="right"
          className="size-6"
          onClick={onMakeDefault}
        />
      )}
    </li>
  );
}

function ClaudeRow({ installed, onOpen }: { installed: boolean; onOpen: () => void }) {
  const detail = installed
    ? "Runs the Claude Code CLI in the project folder. Flare's graph, checkpoints and cost do not see it"
    : "Claude Code was not found on PATH. Install it or set FLARE_CLAUDE_PATH";
  return (
    <li className={ROW}>
      <Tooltip content="New Claude Code session" detail={detail} side="right">
        <button
          type="button"
          aria-disabled={!installed || undefined}
          onClick={installed ? onOpen : undefined}
          className={`${ROW_BUTTON} ${installed ? "" : "opacity-40"}`}
        >
          <Bot aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate">Claude Code</span>
        </button>
      </Tooltip>
    </li>
  );
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function MenuNote({ text }: { text: string }) {
  return <p className="px-2 py-3 text-xs text-fg-subtle">{text}</p>;
}
