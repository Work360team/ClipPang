import type { AnchorHTMLAttributes } from "react";

type HardLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

/**
 * Native navigation for Clip360 Local.
 *
 * Vinext beta's RSC prefetch/client transition currently throws after pages
 * with long-running local effects. A normal anchor avoids that runtime while
 * retaining standard keyboard, new-tab and copy-link behavior.
 */
export function HardLink({ href, children, ...props }: HardLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
