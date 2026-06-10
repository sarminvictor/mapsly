import type { ReactNode } from "react";

/**
 * Landing top-bar shell. Transparent at the very top of the page, then fades to
 * a solid white background with a hairline divider once the user scrolls — so
 * the menu stays legible over content.
 *
 * The scrolled state is toggled by the tiny inline script below: it ships in
 * the SSR HTML and executes the moment the parser reaches it — before the app
 * bundle downloads or hydrates. It sets `data-landing-scrolled` on <html>;
 * `app/globals.css` maps that attribute to the scrolled visuals (white bg,
 * hairline shadow, paddings, compact row height ≤560px).
 *
 * Why not React state: the previous implementation computed the background
 * from a `useState` + post-hydration scroll listener, so the SSR HTML always
 * carried `background: transparent`. Any scroll before hydration finished
 * (cold email click + immediate scroll, reload with scroll restoration, slow
 * mobile network, a hydration error anywhere on the page) left the stuck bar
 * transparent with content visibly scrolling beneath it. The attribute +
 * CSS approach has no hydration dependency, so the bar can never lose its
 * background again. Visuals are unchanged in both states.
 */

const TOPBAR_BOOTSTRAP =
  "(function(){" +
  "if(window.__mapslyTopbar)return;window.__mapslyTopbar=1;" +
  "var d=document.documentElement;" +
  "var f=function(){" +
  'if(window.scrollY>8){d.setAttribute("data-landing-scrolled","")}' +
  'else{d.removeAttribute("data-landing-scrolled")}' +
  "};" +
  "f();" +
  'window.addEventListener("scroll",f,{passive:true});' +
  "})();";

export function StickyHeader({ children }: { children: ReactNode }) {
  return (
    <header className="landing-sticky-header">
      <script dangerouslySetInnerHTML={{ __html: TOPBAR_BOOTSTRAP }} />
      {children}
    </header>
  );
}
