/**
 * Mapsly design system · shared component primitives.
 *
 * Six primitives shared across SMB (Maria) and Agency (Tom) portals.
 * Each accepts an `audience` prop ("smb" | "agency") to switch palette.
 *
 * See `.claude/rules/ui-ux-smb.md` and `.claude/rules/ui-ux-agency.md`
 * for the audience-specific voice + density conventions.
 */
export { Button } from "./Button";
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  ButtonAudience,
} from "./Button";

export { Input } from "./Input";
export type { InputProps, InputAudience } from "./Input";

export {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
} from "./Card";
export type { CardProps, CardDensity, CardAudience } from "./Card";

export { Tile } from "./Tile";
export type { TileProps, TileTone, TileTrend, TileAudience } from "./Tile";

export { Pill } from "./Pill";
export type { PillProps, PillTone, PillSize, PillAudience } from "./Pill";

export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";
