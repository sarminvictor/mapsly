/**
 * Default 3-touch cold sequence (US, plain-text, signal-personalized).
 * Touch 1 is link-free + reply-oriented (best cold deliverability); the report
 * link lands on touch 2–3. Edit freely in the admin sequence editor.
 *
 * Copy uses {{a|b|c}} spintax (resolved deterministically per recipient+step,
 * see modules/cold/template.ts) so bodies aren't byte-identical at scale —
 * duplicate-content fingerprinting is a classic bulk-mail signal. Keep
 * {{tokens}} OUTSIDE spin blocks (engine constraint).
 */
export interface ColdStepSeed {
  stepOrder: number;
  subjectTemplate: string;
  bodyTemplate: string;
  delayDays: number;
  delayHours: number;
}

export const DEFAULT_CAMPAIGN = {
  name: "Cold outreach · default (US)",
  locale: "en",
  country: "US",
  sendWindowStartHour: 9,
  sendWindowEndHour: 17,
  sendTimezone: "America/New_York",
  weekdaysOnly: true,
  dailyEnrollCap: 100,
} as const;

export const DEFAULT_COLD_STEPS: ColdStepSeed[] = [
  {
    stepOrder: 0,
    delayDays: 0,
    delayHours: 0,
    subjectTemplate:
      "{{businessName}} — {{a few things I noticed on|a quick look at|some notes on}} your Google {{profile|listing}}",
    bodyTemplate: `Hi {{businessName}},

{{I was looking at|I spent a few minutes on|I had a look at}} how {{businessName}}{{#if city}} in {{city}}{{/if}} shows up on Google and {{noticed a few things worth a quick look|spotted a few things you may want to see|found a couple of things worth flagging}}{{#if unansweredCount}} — including {{unansweredCount}} customer reviews that haven't been replied to yet{{/if}}.

I put together a {{short, free breakdown|quick, free summary|brief, free report}} of your local presence — reviews, search visibility, your website, and how you compare to nearby businesses. {{Want me to send it over?|Should I send it your way?|Happy to share it — want a copy?}}

{{Best|Thanks|Cheers}},
{{senderFirstName}}`,
  },
  {
    stepOrder: 1,
    delayDays: 3,
    delayHours: 0,
    subjectTemplate:
      "{{your local visibility snapshot|your local presence report|the snapshot I mentioned}}, {{businessName}}",
    bodyTemplate: `Hi {{businessName}},

{{Following up|Circling back|As promised}} — here's the free snapshot I mentioned for {{businessName}}{{#if rating}} (you're at {{rating}}★{{#if reviewCount}} across {{reviewCount}} reviews{{/if}}){{/if}}:

{{reportUrl}}

It takes {{about a minute|a minute or two|under two minutes}} to read and shows {{exactly where you're winning and where a few quick fixes would help|where you stand and which quick fixes would move the needle|what's working and what a few small fixes could improve}}.

{{Best|Thanks|Cheers}},
{{senderFirstName}}`,
  },
  {
    stepOrder: 2,
    delayDays: 4,
    delayHours: 0,
    subjectTemplate:
      "{{last note|closing the loop|one last thing}}, {{businessName}}",
    bodyTemplate: `Hi {{businessName}},

{{I'll leave it here so I'm not cluttering your inbox.|Last note from me — I don't want to clutter your inbox.|I'll stop here — no more emails from me after this.}} If it's useful, your snapshot is still up:

{{reportUrl}}

{{If now's not the time, no worries at all.|If the timing's off, no problem at all.|If it's not a fit right now, all good.}}

{{Best|Thanks|Cheers}},
{{senderFirstName}}`,
  },
];
