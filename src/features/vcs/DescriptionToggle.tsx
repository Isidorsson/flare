import { SwitchButton } from "./SwitchButton";
import { useVcs } from "./use-vcs";
import { draftOf } from "./vcs-selectors";

/** Whether Generate also writes a description, not just the subject line. */
export function DescriptionToggle() {
  const includeBody = useVcs((state) => draftOf(state).includeBody);
  const setIncludeBody = useVcs((state) => state.setIncludeBody);
  return (
    <SwitchButton
      label="with description"
      checked={includeBody}
      hint="Also generate a description"
      detail="Off: only the subject line is written. On: a short explanation of why is added below it"
      onChange={setIncludeBody}
    />
  );
}
