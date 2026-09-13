# Queue-first Review UX

The Review route now leads with the selected ET period, role-aware queue selector, search, and **Review next**. Manager first reviews remain the default for managers; awaiting director approval remains the default for god-mode users. Existing `status`, date, sort, workload, manager, outcome, module, search, and drawer URL values remain unchanged.

Team workload and advanced filters are closed by default. Workload drilldowns use the same current-period rows as the queue. Received remains manager reviewed + awaiting manager + system closed; corrections and coaching are independent overlapping work.

Missing, blank, `__unassigned__`, and literal `Unassigned` owner values share the presentation-only **Needs manager assignment** group. Other normalized email values remain separate. No assignment or authorization data is changed.

The review drawer has one primary vertical scroll flow. Manager feedback and evidence precede director actions; required review fields remain visible in the main flow; original history, technical details, and discussion are available on demand.

Browser checks use synthetic `@example.test` fixtures and write screenshots only under ignored `test-results/` output.
