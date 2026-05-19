# Build log · append-only

Every autonomous session writes one entry at close-time. Most recent at top.

Schema per entry:

```
## SES-YYYY-MM-DD-N

- Started: ISO
- Ended: ISO
- Exit: token-budget | timeout | hard-halt | clean
- Tasks completed: list of phase IDs
- PRs opened: numbers + status
- PRs auto-merged: numbers
- PRs needs-review: numbers
- Incidents new: list of INC- IDs
- Incidents recurring: list of INC- IDs cited
- Score average: X.X
- Cost USD: X.XX
- Tokens used: input / output / total
```

---

(no sessions yet — first scheduled run will create the first entry)
