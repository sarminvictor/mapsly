/**
 * SMB "My Business" · module barrel.
 *
 * Server-only surface. Client components must not import from here —
 * they'd drag Prisma + NextAuth into the client bundle.
 */

export { getSmbMyBusinessData } from "./queries";
export {
  addService,
  renameService,
  removeService,
  restoreService,
  reorderServices,
} from "./actions";
export {
  EMPTY_SMB_MY_BUSINESS,
  type BusinessServiceRow,
  type ServiceSource,
  type SmbMyBusinessData,
} from "./types";
