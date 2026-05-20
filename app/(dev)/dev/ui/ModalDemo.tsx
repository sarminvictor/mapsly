"use client";

import * as React from "react";
import { Button, Modal } from "@/components/ui";

export default function UiShowcaseModalDemo() {
  const [openSmb, setOpenSmb] = React.useState(false);
  const [openAgency, setOpenAgency] = React.useState(false);

  return (
    <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
      <Button audience="smb" onClick={() => setOpenSmb(true)}>
        Open SMB modal
      </Button>
      <Button audience="agency" onClick={() => setOpenAgency(true)}>
        Open Agency modal
      </Button>

      <Modal
        open={openSmb}
        onClose={() => setOpenSmb(false)}
        title="Reply to 8 unanswered reviews"
        description="We'll draft replies in your tone and let you review before posting."
        footer={
          <>
            <Button
              audience="smb"
              variant="secondary"
              onClick={() => setOpenSmb(false)}
            >
              Cancel
            </Button>
            <Button audience="smb" onClick={() => setOpenSmb(false)}>
              Draft 8 replies
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: "#374151", fontSize: 14 }}>
          Most spas reply to about 89% of reviews. You&apos;re at 0%. We can
          help — this typically takes about 6 minutes of your time per session.
        </p>
      </Modal>

      <Modal
        open={openAgency}
        onClose={() => setOpenAgency(false)}
        title="Delete list · 47 qualified leads"
        description="This list took 6 days to qualify. Confirm before deletion."
        footer={
          <>
            <Button
              audience="agency"
              variant="secondary"
              onClick={() => setOpenAgency(false)}
            >
              Cancel
            </Button>
            <Button
              audience="agency"
              variant="destructive"
              onClick={() => setOpenAgency(false)}
            >
              Delete · 47 leads
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: "#374151", fontSize: 14 }}>
          You&apos;ll lose 47 qualified leads · 14 already contacted · 3 in
          replied state. This can&apos;t be undone.
        </p>
      </Modal>
    </div>
  );
}
