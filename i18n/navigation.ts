// Locale-aware navigation primitives.
// `Link`, `redirect`, `usePathname`, `useRouter` wrap next-intl's helpers so
// callers never have to prefix the locale by hand — passing a logical pathname
// like "/signin" resolves to /signin, /es/iniciar-sesion, /fr/connexion, etc.
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const {
  Link,
  redirect,
  permanentRedirect,
  usePathname,
  useRouter,
  getPathname,
} = createNavigation(routing);
