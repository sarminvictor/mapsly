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
    "/usage": {
      en: "/usage",
      es: "/uso",
      "en-CA": "/usage",
      fr: "/utilisation",
    },
    "/website": {
      en: "/website",
      es: "/sitio",
      "en-CA": "/website",
      fr: "/site",
    },
    "/discover": {
      en: "/discover",
      es: "/descubrir",
      "en-CA": "/discover",
      fr: "/decouvrir",
    },
    "/discover/[discoveryId]": {
      en: "/discover/[discoveryId]",
      es: "/descubrir/[discoveryId]",
      "en-CA": "/discover/[discoveryId]",
      fr: "/decouvrir/[discoveryId]",
    },
    "/discover/[discoveryId]/signals": {
      en: "/discover/[discoveryId]/signals",
      es: "/descubrir/[discoveryId]/senales",
      "en-CA": "/discover/[discoveryId]/signals",
      fr: "/decouvrir/[discoveryId]/signaux",
    },
    "/discover/[discoveryId]/lists/[listId]": {
      en: "/discover/[discoveryId]/lists/[listId]",
      es: "/descubrir/[discoveryId]/listas/[listId]",
      "en-CA": "/discover/[discoveryId]/lists/[listId]",
      fr: "/decouvrir/[discoveryId]/listes/[listId]",
    },
    "/discover/[discoveryId]/business/[businessId]": {
      en: "/discover/[discoveryId]/business/[businessId]",
      es: "/descubrir/[discoveryId]/negocio/[businessId]",
      "en-CA": "/discover/[discoveryId]/business/[businessId]",
      fr: "/decouvrir/[discoveryId]/entreprise/[businessId]",
    },
    "/touchpoints": {
      en: "/touchpoints",
      es: "/contactos",
      "en-CA": "/touchpoints",
      fr: "/points-de-contact",
    },
    "/campaigns": {
      en: "/campaigns",
      es: "/campanas",
      "en-CA": "/campaigns",
      fr: "/campagnes",
    },
    "/campaigns/new": {
      en: "/campaigns/new",
      es: "/campanas/nueva",
      "en-CA": "/campaigns/new",
      fr: "/campagnes/nouvelle",
    },
  },
});

export type Locale = (typeof routing.locales)[number];
