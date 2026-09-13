# Queue-first Review UX

The Review route now leads with the selected ET period, role-aware queue selector, search, and **Review next**. Manager first reviews remain the default for managers; awaiting director approval remains the default for god-mode users. Existing `status`, date, sort, workload, manager, outcome, module, search, and drawer URL values remain unchanged.

Team workload and advanced filters are closed by default. Directors can drill into each current manager; managers retain their own compact totals and alert-type breakdown on demand. Workload drilldowns use the same current-period rows as the queue. Received remains manager reviewed + awaiting manager + system closed; corrections and coaching are independent overlapping work.

Missing, blank, `__unassigned__`, and literal `Unassigned` owner values share the presentation-only **Needs manager assignment** group. Other normalized email values remain separate. No assignment or authorization data is changed.

Below the desktop breakpoint, each queue row presents issue, status/next action, agent, contact, summary, and time without horizontal panning. The same row element continues to own opening, keyboard navigation, paging, and optional bulk selection.

The review drawer has one primary vertical scroll flow plus a compact fixed action footer. Manager feedback and evidence precede director actions; required review fields remain visible in the main flow; original history, technical details, and discussion are available on demand. A director editing their own review must save that revision before approving it.

Browser checks use synthetic `@example.test` fixtures and write screenshots only under ignored `test-results/` output.
