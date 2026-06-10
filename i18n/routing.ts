import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "es", "en-CA", "fr"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  // English-only for now: no Accept-Language auto-detection, no switcher —
  // everyone gets English. The 4 locales below stay wired so we can turn
  // multi-language back on later without re-plumbing the routing.
  localeDetection: false,
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
    "/refunds": {
      en: "/refunds",
      es: "/reembolsos",
      "en-CA": "/refunds",
      fr: "/remboursements",
    },
    "/home": {
      en: "/home",
      es: "/inicio",
      "en-CA": "/home",
      fr: "/accueil",
    },
    "/lists": {
      en: "/lists",
      es: "/listas",
      "en-CA": "/lists",
      fr: "/listes",
    },
    "/lists/[id]": {
      en: "/lists/[id]",
      es: "/listas/[id]",
      "en-CA": "/lists/[id]",
      fr: "/listes/[id]",
    },
    "/list-analytics": {
      en: "/list-analytics",
      es: "/analitica-de-listas",
      "en-CA": "/list-analytics",
      fr: "/analytique-des-listes",
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
    "/ads": {
      en: "/ads",
      es: "/anuncios",
      "en-CA": "/ads",
      fr: "/publicites",
    },
    "/reviews": {
      en: "/reviews",
      es: "/resenas",
      "en-CA": "/reviews",
      fr: "/avis",
    },
    "/search": {
      en: "/search",
      es: "/visibilidad",
      "en-CA": "/search",
      fr: "/visibilite",
    },
    "/hunter": {
      en: "/hunter",
      es: "/cazador",
      "en-CA": "/hunter",
      fr: "/chasseur",
    },
    "/prospect": {
      en: "/prospect",
      es: "/prospecto",
      "en-CA": "/prospect",
      fr: "/prospect",
    },
    "/prospect/[businessId]": {
      en: "/prospect/[businessId]",
      es: "/prospecto/[businessId]",
      "en-CA": "/prospect/[businessId]",
      fr: "/prospect/[businessId]",
    },
    "/onboarding": {
      en: "/onboarding",
      es: "/bienvenida",
      "en-CA": "/onboarding",
      fr: "/bienvenue",
    },
    "/setup": {
      en: "/setup",
      es: "/configurar",
      "en-CA": "/setup",
      fr: "/configurer",
    },
    "/settings": {
      en: "/settings",
      es: "/configuracion",
      "en-CA": "/settings",
      fr: "/parametres",
    },
    "/my-business": {
      en: "/my-business",
      es: "/mi-negocio",
      "en-CA": "/my-business",
      fr: "/mon-entreprise",
    },
    "/settings/billing": {
      en: "/settings/billing",
      es: "/configuracion/facturacion",
      "en-CA": "/settings/billing",
      fr: "/parametres/facturation",
    },
    "/agency-settings": {
      en: "/agency-settings",
      es: "/configuracion-agencia",
      "en-CA": "/agency-settings",
      fr: "/parametres-agence",
    },
    "/team/billing": {
      en: "/team/billing",
      es: "/equipo/facturacion",
      "en-CA": "/team/billing",
      fr: "/equipe/facturation",
    },
    "/share/[publicShareId]": {
      en: "/share/[publicShareId]",
      es: "/compartir/[publicShareId]",
      "en-CA": "/share/[publicShareId]",
      fr: "/partage/[publicShareId]",
    },
    "/website": {
      en: "/website",
      es: "/sitio",
      "en-CA": "/website",
      fr: "/site",
    },
    "/list-activity": {
      en: "/list-activity",
      es: "/actividad-listas",
      "en-CA": "/list-activity",
      fr: "/activite-listes",
    },
    "/reports": {
      en: "/reports",
      es: "/informes",
      "en-CA": "/reports",
      fr: "/rapports",
    },
  },
});

export type Locale = (typeof routing.locales)[number];
