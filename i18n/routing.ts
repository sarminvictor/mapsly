import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es', 'en-CA', 'fr'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeDetection: true,
  pathnames: {
    '/': '/',
    '/for-businesses': {
      en: '/for-businesses',
      es: '/para-empresas',
      'en-CA': '/for-businesses',
      fr: '/pour-entreprises',
    },
    '/for-agencies': {
      en: '/for-agencies',
      es: '/para-agencias',
      'en-CA': '/for-agencies',
      fr: '/pour-agences',
    },
    '/pricing': {
      en: '/pricing',
      es: '/precios',
      'en-CA': '/pricing',
      fr: '/tarifs',
    },
    '/dashboard': {
      en: '/dashboard',
      es: '/panel',
      'en-CA': '/dashboard',
      fr: '/tableau',
    },
    '/lists': {
      en: '/lists',
      es: '/listas',
      'en-CA': '/lists',
      fr: '/listes',
    },
  },
});

export type Locale = (typeof routing.locales)[number];
