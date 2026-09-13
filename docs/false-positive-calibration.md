# False-alarm calibration

The review workspace records manager judgments; it does not establish model ground truth. Use the [read-only baseline](./sql/false-positive-baseline.sql) to identify burden before changing an evaluator. Run it in an authorized database session; do not commit production query results or customer evidence to this repository.

## Definitions

- One alert is one sent `(call_id, module_name)` result, not a call or an individual evidence item. Several alerts may refer to one call; one Full QA alert may contain several concerns.
- Internal Pennie workload excludes the hidden disposition module and partner Welcome Call QA. Historical GOTA alerts remain in the workload. Current visibility and delivery behavior must be checked before comparing time periods.
- A review is the latest non-system decision row. Historic administrative closures (`system@pennie`) are not judgments that the evaluator was correct. Older rows may lack the detail required by today's review form.
- Manager-marked false share = false decisions / recorded non-system decisions. Always show both counts and review coverage. Unreviewed does not mean accurate.
- The SQL cohorts by alert creation in Eastern time. It does not answer “how many reviews did someone perform this week?” Feedback is mutable; replaying an old cohort later does not reconstruct the decisions as they existed then.
- Module exposure, prompt changes, reviewer mix and incomplete review coverage can change an aggregate rate. A module moving to shadow/unsent is not proof of an accuracy improvement.

## Evidence needed before changing prompts

1. Collect the reported example groups with alert IDs in an access-controlled location, not this public repository.
2. Sample the high-volume active module across reason categories and reviewers. Include both manager-dismissed and manager-confirmed alerts. Keep multiple alerts from the same call/lead together when splitting evaluation sets, to avoid leaking related context into the holdout.
3. Have a policy owner adjudicate each concern using the actual transcript and applicable policy. Record whether policy applied, which call contains the evidence, and the expected result. A reason category is a hypothesis, not a gold label.
4. Classify the failure: missing context/prior call, acceptable paraphrase, incorrect or misattributed evidence, wrong eligibility/policy, incomplete call, or reviewer disagreement. Preserve an “unresolved” outcome rather than forcing a label.
5. Include relevant unflagged calls to inspect missed violations. False-alert review alone cannot measure false negatives or recall.

## Smallest useful experiment

Use the existing evaluator fixtures and runner patterns in the backend repository. Inspect its current branch and deployment revision first; do not depend on unrelated uncommitted evaluation work. Existing prior-transcript resolution should be tested before adding another context mechanism.

Compare the baseline and one targeted candidate on the same adjudicated held-out cases:

| Check | Requirement |
|---|---|
| False alerts | Report counts and denominator by module/reason, not only a pooled percentage |
| True violations retained | Candidate must not silently remove known real violations; inspect each regression |
| Missed violations | Report the checked unflagged sample and its limits; do not claim recall from false labels alone |
| Evidence | The cited text must exist, belong to the correct speaker/call, and support the allegation |
| Context | Prior-call evidence must match the lead, occur before the evaluated event, and satisfy the relevant policy |
| Reproducibility | Record model identifier, prompt/code revisions and evaluation case version with the result |

Do not tune on the holdout, blanket-ignore a category solely because managers dislike it, or count fewer emitted alerts as success by itself. A numerical reduction target and production prompt change require adjudicated examples and retained-violation checks.

The UI/data changes can proceed independently. Missing example links and policy judgments block evaluator calibration, not workload reconciliation or better feedback capture.
