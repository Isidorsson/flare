import { FileSearch } from "lucide-react";

import { EmptyState } from "@/shared/ui/EmptyState";

export function FilesPanel() {
  return (
    <EmptyState
      icon={FileSearch}
      title="No file activity yet"
      description="Files the agent reads or edits will open here, with a diff for every change."
    />
  );
}
