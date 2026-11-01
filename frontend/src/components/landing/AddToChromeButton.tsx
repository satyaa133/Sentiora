import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { buttonClasses, cx } from "@shared/ui";
import type { ButtonSize, ButtonVariant } from "@shared/ui";

import { ADD_TO_CHROME_FALLBACK_PATH, CHROME_STORE_URL } from "./links";

interface AddToChromeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

export default function AddToChromeButton({
  variant = "primary",
  size = "md",
  className,
  children = "Add to Chrome",
}: AddToChromeButtonProps) {
  const classes = cx(buttonClasses(variant, size), className);
  if (CHROME_STORE_URL) {
    return (
      <a
        href={CHROME_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={ADD_TO_CHROME_FALLBACK_PATH} className={classes}>
      {children}
    </Link>
  );
}
