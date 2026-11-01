import { useState } from "react";

import { IconEye, IconEyeOff, TextField } from "@shared/ui";
import type { TextFieldProps } from "@shared/ui";

/** TextField for passwords with a labelled show/hide toggle. */
export default function PasswordField(
  props: Omit<TextFieldProps, "type" | "trailing">,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="flex h-9 w-9 items-center justify-center rounded-btn text-muted hover:bg-raised hover:text-fg"
        >
          {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
        </button>
      }
    />
  );
}
