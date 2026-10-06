# Human voice quality validation

Status values: **PASS / FAIL / NOT TESTED**. All listening results are **NOT TESTED** until someone hears live provider audio on representative devices. Automated tests use mocks and cannot establish quality.

| Locale / voice | Male | Female | Clarity | Naturalness | Navigation | Room numbers | Distances | Exam reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arabic MSA / Google Chirp 3 HD | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Arabic Saudi / Azure ar-SA Neural | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| English / Google Chirp 3 HD | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Chinese / Google Chirp 3 HD | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |

## Listening procedure

1. Configure live Google and Azure Speech resources on a staging server. Verify the exact listed voices against the resource and region. Record provider/region and date without secrets.
2. Listen to each male and female voice at normal, slow and faster rates with headphones and phone speakers. Score clarity and naturalness separately.
3. Test route turns, arrival, relocalization and critical/high safety interruption. Confirm route change cancels the old instruction.
4. Test “غرفة 121”, “15 متر”, mixed Arabic/English and an English/Chinese sentence. Check room digit and distance pronunciation against the intended meaning.
5. Read a real exam question and choices with both MSA and Saudi accents. Confirm the printed academic wording is unchanged.
6. Test offline/browser fallback and screen reader mode on actual target devices. Record failures and device/browser details.

Decision: **Ready for human voice quality validation** after live credentials are configured. Human listening and live provider validation are still required for all four language/style rows.
