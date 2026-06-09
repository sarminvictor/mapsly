/**
 * Default 3-touch cold sequence (US, plain-text, signal-personalized).
 * Touch 1 is link-free + reply-oriented (best cold deliverability); the report
 * link lands on touch 2–3. Edit freely in the admin sequence editor.
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
      "{{businessName}} — quick question about your Google profile",
    bodyTemplate: `Hi {{businessName}},

I was looking at how {{businessName}}{{#if city}} in {{city}}{{/if}} shows up on Google and noticed a few things worth a quick look{{#if unansweredCount}} — including {{unansweredCount}} customer reviews that haven't been replied to yet{{/if}}.

I put together a short, free breakdown of your local presence — reviews, search visibility, your website, and how you compare to nearby businesses. Want me to send it over?

Best,
{{senderFirstName}}`,
  },
  {
    stepOrder: 1,
    delayDays: 3,
    delayHours: 0,
    subjectTemplate: "your local visibility snapshot, {{businessName}}",
    bodyTemplate: `Hi {{businessName}},

Following up — here's the free snapshot I mentioned for {{businessName}}{{#if rating}} (you're at {{rating}}★{{#if reviewCount}} across {{reviewCount}} reviews{{/if}}){{/if}}:

{{reportUrl}}

It takes about a minute to read and shows exactly where you're winning and where a few quick fixes would help.

Best,
{{senderFirstName}}`,
  },
  {
    stepOrder: 2,
    delayDays: 4,
    delayHours: 0,
    subjectTemplate: "last note, {{businessName}}",
    bodyTemplate: `Hi {{businessName}},

I'll leave it here so I'm not cluttering your inbox. If it's useful, your snapshot is still up:

{{reportUrl}}

If now's not the time, no worries at all.

Best,
{{senderFirstName}}`,
  },
];
