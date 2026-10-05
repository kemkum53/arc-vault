import type { MouseEvent } from "react";

/** Hash routes: "" home, "matrix", "<accountId>/<tab>". */
export const routes = {
  home: "",
  matrix: "matrix",
  account: (id: string, tab = "dashboard") => `${id}/${tab}`,
};

export const hrefFor = (route: string) => (route ? `#${route}` : "#");

/**
 * Click handler for in-app links: a plain left click runs fn inside the app,
 * while ctrl/cmd/shift/middle clicks fall through so the browser can open the
 * link's href in a new tab or window.
 */
export function onPlainClick(fn: () => void) {
  return (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    fn();
  };
}
