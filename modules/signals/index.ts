/**
 * Signals module · barrel export
 *
 * Public surface for the rest of the app. Hunter UI, Prospect view, cron
 * handlers, and the Mapsly Score formula all import from here.
 */

export type {
  BooleanComparator,
  Comparator,
  DateComparator,
  EnumComparator,
  FilterRow,
  FilterValue,
  NumericComparator,
  SignalCadence,
  SignalCategory,
  SignalDefinition,
  SignalSource,
  SignalValueType,
  StringComparator,
} from "./types";

export {
  BOOLEAN_COMPARATORS,
  COMPARATORS_BY_TYPE,
  DATE_COMPARATORS,
  ENUM_COMPARATORS,
  evaluate,
  isValidComparator,
  NUMERIC_COMPARATORS,
  STRING_COMPARATORS,
} from "./comparators";

export {
  CATEGORIES,
  CATEGORIES_ORDERED,
  type CategoryDefinition,
} from "./categories";

export {
  getSignal,
  getSignalsByCategory,
  SIGNAL_COUNT,
  SIGNALS,
  SIGNALS_ORDERED,
} from "./registry";
