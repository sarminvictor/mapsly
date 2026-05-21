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
    "/privacy": {
      en: "/privacy",
      es: "/privacidad",
      "en-CA": "/privacy",
      fr: "/confidentialite",
    },
    "/terms": {
      en: "/terms",
      es: "/terminos",
      "en-CA": "/terms",
      fr: "/conditions",
    },
    "/cookies": {
      en: "/cookies",
      es: "/cookies",
      "en-CA": "/cookies",
      fr: "/temoins",
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
    "/reviews": {
      en: "/reviews",
      es: "/resenas",
      "en-CA": "/reviews",
      fr: "/avis",
    },
    "/competitors": {
      en: "/competitors",
      es: "/competidores",
      "en-CA": "/competitors",
      fr: "/concurrents",
    },
    "/search": {
      en: "/search",
      es: "/visibilidad",
      "en-CA": "/search",
      fr: "/visibilite",
    },
  },
});

export type Locale = (typeof routing.locales)[number];
