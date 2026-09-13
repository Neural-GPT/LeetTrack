"use client";

import dynamic from "next/dynamic";

/**
 * ChatBubble polls every 5s and carries its own message-list UI, none
 * of which is needed for the very first paint of any page — code
 * splitting it into its own chunk (rather than bundling it into every
 * page that renders StudentShell) means the browser can parse/execute
 * the actually-critical page content first, then fetch and mount the
 * chat bubble a beat later. `ssr: false` skips server-rendering it
 * entirely (it's pure client state — unread counts, polling — so
 * there's nothing useful to render on the server anyway) and avoids a
 * hydration mismatch between server and client renders.
 *
 * Purely a loading-order/bundle-splitting change — same component,
 * same props, same behavior once mounted.
 */
export default dynamic(() => import("./ChatBubble"), { ssr: false });
