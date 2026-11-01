import type { ReactNode } from "react";

import { Card, Echo } from "@shared/ui";
import type { EchoState } from "@shared/ui";

interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  echo?: EchoState;
}

/** Faded Echo with a short message: empty lists, no results. */
export default function EmptyState({
  title,
  body,
  action,
  echo = "faded",
}: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center py-10 text-center">
      <Echo state={echo} size={72} />
      <p className="mt-4 text-[17px] font-semibold text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-[15px] text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Card>
  );
}
