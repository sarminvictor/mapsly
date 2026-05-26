import { redirect } from "next/navigation";

/**
 * /admin index · redirects to the only section we have today.
 * When more admin sections land we'll replace this with a real landing
 * page (status overview, links to each section).
 */
export default function AdminIndexPage(): never {
  redirect("/admin/discovery");
}
