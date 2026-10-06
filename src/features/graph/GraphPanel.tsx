import { Network } from "lucide-react";

import { EmptyState } from "@/shared/ui/EmptyState";

export function GraphPanel() {
  return (
    <EmptyState
      icon={Network}
      title="No graph yet"
      description="Open a project to see how its files import each other and where the agent is working."
    />
  );
}
