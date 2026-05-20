import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "es", "en-CA", "fr"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: true,
  pathnames: {
    "/": "/",
    "/for-businesses": {
      en: "/for-businesses",
      es: "/para-empresas",
      "en-CA": "/for-businesses",
      fr: "/pour-entreprises",
    },
    "/for-agencies": {
      en: "/for-agencies",
      es: "/para-agencias",
      "en-CA": "/for-agencies",
      fr: "/pour-agences",
    },
    "/pricing": {
      en: "/pricing",
      es: "/precios",
      "en-CA": "/pricing",
      fr: "/tarifs",
    },
    "/dashboard": {
      en: "/dashboard",
      es: "/panel",
      "en-CA": "/dashboard",
      fr: "/tableau",
    },
    "/lists": {
      en: "/lists",
      es: "/listas",
      "en-CA": "/lists",
      fr: "/listes",
    },
    "/signin": {
      en: "/signin",
      es: "/iniciar-sesion",
      "en-CA": "/signin",
      fr: "/connexion",
    },
    "/signin/check-email": {
      en: "/signin/check-email",
      es: "/iniciar-sesion/revisa-tu-correo",
      "en-CA": "/signin/check-email",
      fr: "/connexion/verifiez-vos-courriels",
    },
    "/post-signin": {
      en: "/post-signin",
      es: "/post-acceso",
      "en-CA": "/post-signin",
      fr: "/post-connexion",
    },
  },
});

export type Locale = (typeof routing.locales)[number];
