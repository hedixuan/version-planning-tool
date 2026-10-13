import type { KeyboardEvent } from "react";

export function openOnKeyboard(
  event: KeyboardEvent<HTMLElement>,
  callback: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    callback();
  }
}
