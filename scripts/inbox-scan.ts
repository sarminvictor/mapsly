// scripts/inbox-scan.ts · READ-ONLY diagnostic sweep of the cold mailboxes.
//
// INC-2026-07-29: an ad-hoc diagnostic fetch downloaded BODY[] without PEEK,
// marking an unsubscribe email \Seen — and poll-cold-inboxes processes UNSEEN
// only, so the opt-out was never honored until caught by hand. Every mailbox
// diagnostic MUST go through this script: it opens each mailbox with
// { readOnly: true }, so no fetch can consume the poller's unseen marker.
//
// Usage:
//   pnpm tsx scripts/inbox-scan.ts [--since=2026-07-23] [--folder=INBOX]
//   --folder=all   also sweeps common spam/junk folder names.

import { config } from "dotenv";
config({ path: ".env.local" });

import { ImapFlow } from "imapflow";
import { getImapConfig, getMailboxCreds } from "@/services/cold-mailer/config";

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const folderArg = process.argv.find((a) => a.startsWith("--folder="));
const SINCE = new Date(sinceArg ? sinceArg.slice(8) : "2026-07-23");
const FOLDERS =
  folderArg?.slice(9) === "all"
    ? ["INBOX", "Junk", "Spam", "Junk Email", "Bulk"]
    : [folderArg?.slice(9) ?? "INBOX"];

function decodeSnippet(raw: string): string {
  const sep = raw.indexOf("\r\n\r\n");
  return raw
    .slice(sep + 4)
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

async function main() {
  const { host, port, secure } = getImapConfig();
  const creds = getMailboxCreds();
  console.log(
    `read-only sweep · ${creds.length} boxes · since ${SINCE.toISOString().slice(0, 10)} · folders: ${FOLDERS.join(", ")}`,
  );
  for (const cred of creds) {
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user: cred.address, pass: cred.password },
      logger: false,
    });
    try {
      await client.connect();
      for (const folder of FOLDERS) {
        try {
          // READ-ONLY open — fetches cannot set \Seen (the poller's marker).
          const mailbox = await client.mailboxOpen(folder, { readOnly: true });
          const uids = await client.search({ since: SINCE }, { uid: true });
          if (!uids || uids.length === 0) {
            if (folder === "INBOX")
              console.log(`\n${cred.address} · ${folder}: 0 msgs`);
            continue;
          }
          console.log(
            `\n══ ${cred.address} · ${folder} · ${uids.length} msgs ══`,
          );
          for (const uid of uids.slice(-20)) {
            const msg = await client.fetchOne(
              String(uid),
              { envelope: true, source: true, flags: true },
              { uid: true },
            );
            if (!msg || !msg.envelope) continue;
            const from = msg.envelope.from?.[0];
            const seen = msg.flags?.has("\\Seen") ? "seen" : "UNSEEN";
            console.log(
              `  [${msg.envelope.date?.toISOString().slice(0, 16)}] (${seen}) ${from?.name ?? ""} <${from?.address}>`,
            );
            console.log(`    SUBJ: ${msg.envelope.subject}`);
            if (msg.source)
              console.log(`    ${decodeSnippet(msg.source.toString("utf8"))}`);
          }
          void mailbox;
        } catch {
          // folder doesn't exist on this account — fine
        }
      }
      await client.logout();
    } catch (e) {
      console.log(`${cred.address}: ERROR ${String(e).slice(0, 100)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 300));
    process.exit(1);
  });
