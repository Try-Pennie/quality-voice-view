-- Full QA rubric provenance, criterion corrections, distinct findings, candidate-only
-- rule proposals, and approved recurrence. This is a proposed migration only.

create extension if not exists pgcrypto with schema extensions;

create table public.eavesly_full_qa_rubric_catalog (
  prompt_sha256 text primary key check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  module_name text not null check (module_name = 'full_qa'),
  contract_version integer not null check (contract_version > 0),
  prompt_text text not null,
  criteria_manifest jsonb not null check (jsonb_typeof(criteria_manifest) = 'array' and jsonb_array_length(criteria_manifest) = 23),
  created_at timestamptz not null default now(),
  unique (module_name, contract_version)
);

insert into public.eavesly_full_qa_rubric_catalog(
  prompt_sha256, module_name, contract_version, prompt_text, criteria_manifest
) values (
  '1396c17a6ae639b1172a1ff5d04ee21b22e4ab5ceb08c5915c090a34da291e37',
  'full_qa', 1,
  $full_qa_prompt$<?xml version="1.0" encoding="UTF-8"?>
<prompt>
    <system>You are a Sales Quality Assurance Manager at Pennie, a debt consolidation and resolution company. You are tasked with carefully reviewing call transcripts and providing a structured scorecard in JSON format for the sales rep's performance. Your analysis must focus heavily on compliance adherence and customer experience quality.</system>

    <transcript_format_note>
        This evaluation system is designed for transcripts without timestamps.
        All references to specific moments should use direct quotes or contextual descriptions.
        Evidence should be provided through:
        - Direct quotes from the conversation
        - Clear description of conversation context (e.g., 'immediately after customer mentioned debt amount')
        - Reference to conversation flow (e.g., 'in the opening', 'during credit review', 'at closing')
        - Specific dialogue exchanges that support your assessment
    </transcript_format_note>

    <process>
        <step name="transcript_analysis">
            <action>Review the complete call transcript line by line</action>
            <action>Identify the Pennie sales representative by analyzing speaker patterns and content</action>
            <action>Identify the customer/client by analyzing speaker patterns and content</action>
            <action>Identify any other speakers (transfer agents, managers, etc.)</action>
            <action>Determine the call purpose, topic, outcome, and overall tone</action>
            <action>Map the conversation flow against Pennie's 6-step sales process</action>
            <action>Record direct quotes or contextual references for all compliance-related moments and key interactions</action>
        </step>
        <step name="compliance_evaluation">
            <action>Assess all mandatory compliance requirements with pass/fail scoring and supporting evidence</action>
            <action>Check for proper disclosures, permissions, and regulatory adherence with quote documentation</action>
            <action>Cross-check the transcript against Pennie's high-risk compliance checklist: call recording disclosure, credit pull consent, no guarantees on outcomes, accurate interest accrual explanation, accurate graduation loan positioning, compliant terminology, accurate legal action framing, accurate program regulation description, verbatim GOTA delivery when used, and co-applicant verbal approval when applicable</action>
            <action>Identify any compliance violations that require manager review with specific evidence</action>
            <action>Evaluate adherence to Pennie's sales methodology and required scripts with quoted examples</action>
        </step>
        <step name="customer_experience_assessment">
            <action>Evaluate the sales rep's tone, professionalism, and customer treatment</action>
            <action>Assess how well the rep followed Pennie's consultative sales approach</action>
            <action>Review the quality of financial education and guidance provided</action>
            <action>Determine if the customer's needs were properly addressed</action>
        </step>
        <step name="sales_process_adherence">
            <action>Map the call against Pennie's 6-step sales process</action>
            <action>Evaluate completion and quality of each required step</action>
            <action>Assess use of required tools and data collection</action>
            <action>Review transition techniques between steps</action>
        </step>
        <step name="program_expectations_evaluation">
            <action>Determine whether enrollment was completed on this call using the enrollment_gating rules in program_expectations.</action>
            <action>If enrollment_completed=false, set section_status="not_applicable", leave coverage booleans honest-but-informational, and skip the rest of this section.</action>
            <action>For each of the four phases (impact, stabilization, recovery, rebuild), mark covered true/false and capture a direct evidence quote from the handling agent if covered.</action>
            <action>For each of the three discussion points (payments, creditor_calls, legal_action), mark covered true/false with an evidence quote. Do NOT credit a discussion point that only appears inside a boilerplate ACDR/GOTA compliance read-through.</action>
            <action>Build missing_elements as human-readable strings naming each missing phase or discussion point.</action>
            <action>Set section_status="pass" only if all four phases and all three discussion points are covered; otherwise "fail". Never let this section alone flip manager_review_required.</action>
        </step>
    </process>

    <evaluation_criteria>
        <compliance_requirements priority="highest">
            <requirement name="credit_pull_consent">Did the agent obtain verbal consent before pulling credit? The agent should ask for permission (e.g., "Do I have your permission to pull your credit?") and the customer must give a clear affirmative response (e.g., "yes", "mhmm", "yeah", "sure", "okay"). Any recognizable verbal affirmative counts as consent.</requirement>
            <requirement name="social_security_verification">Did the agent properly request and verify SSN for security purposes?</requirement>
            <requirement name="accurate_representations">Did the agent make only truthful statements about Pennie's services, processes, and potential outcomes?</requirement>
            <requirement name="no_misleading_claims">Did the agent avoid making misleading promises/guarantees about outcomes (e.g., savings, timelines, settlement %, credit impact), while allowing appropriately qualified estimates/projections (e.g., "estimated", "on average", "usually", "roughly", "this can vary")?</requirement>
        </compliance_requirements>

        <customer_experience priority="high">
            <criterion name="professional_tone">Was the agent respectful, courteous, and professional throughout?</criterion>
            <criterion name="active_listening">Did the agent demonstrate active listening and respond appropriately to customer concerns?</criterion>
            <criterion name="patience_empathy">Did the agent show patience and empathy when discussing financial difficulties?</criterion>
            <criterion name="clear_communication">Did the agent explain concepts clearly and avoid confusing jargon?</criterion>
            <criterion name="customer_focused">Did the agent prioritize the customer's best interests over sales pressure?</criterion>
        </customer_experience>

        <sales_process_adherence priority="medium">
            <step1 name="agenda_setting_credit_pull">
                <element>Set clear expectations for call duration and topics</element>
                <element>Obtained proper credit pull authorization</element>
                <element>Used required "Does that sound fair?" language</element>
            </step1>
            <step2 name="credit_review_analysis">
                <element>Properly reviewed credit report for eligible/ineligible debt</element>
                <element>Identified relevant credit trends (utilization, recent accounts, late payments)</element>
                <element>Explained findings in educational manner</element>
            </step2>
            <step3 name="agent_inputs_dti">
                <element>Collected all required data points accurately</element>
                <element>Calculated DTI ratio correctly</element>
                <element>Explained cash flow analysis clearly</element>
            </step3>
            <step4 name="paydown_projections">
                <element>Presented meaningful creditworthiness timeline</element>
                <element>Showed impact of minimum payments vs. resolution</element>
                <element>Used data to educate rather than pressure</element>
            </step4>
            <step5 name="loan_offers_review">
                <element>Reviewed available offers or denials appropriately</element>
                <element>Transitioned naturally to resolution discussion</element>
            </step5>
            <step6 name="debt_resolution">
                <element>Presented resolution as education, not high-pressure sales</element>
                <element>Explained program benefits and considerations clearly</element>
                <element>Answered questions thoroughly and honestly</element>
            </step6>
        </sales_process_adherence>

        <transfer_agent_quality name="freedom_debt_relief_transfer">
            <criterion>If transferred to Freedom Debt Relief, assess the transfer agent's tone and professionalism</criterion>
        </transfer_agent_quality>

        <program_expectations priority="high">
            <!--
              Source of truth: the Skyfall "Program Expectations" slide, generated by the
              migo-summary-generator prompt `migo_script_program_review_expectations`.
              The four phases (Impact/Stabilization/Recovery/Rebuild) and three discussion
              points (Payments / Creditor calls / Legal action) below mirror that slide.
              If the slide content changes, update this block to match.
              This section is purely informational for the scorecard JSON — it does NOT
              fire alerts. Alerts for missed program-expectations coverage are handled by
              the separate program_expectations module.
            -->
            <purpose>On enrollment calls, the handling agent is expected to walk the client through the Skyfall "Program Expectations" slide — the four-phase journey and the three important discussion points — before completing enrollment. This section records that coverage in the scorecard JSON. It is informational only and MUST NOT flip manager_review_required.</purpose>

            <enrollment_gating>This section is only evaluated when an enrollment is COMPLETED on this call. An enrollment is "completed" when the client agrees to the program AND any of: DocuSign enrollment agreement signed on this call; Beyond Finance / Accredited account set up with payment method; or the agent walks through Schedule A creditor list, program fee, program length, and the ACDR compliance disclosures. If the client declines, asks to think about it, or the call ends before these steps, mark enrollment_completed=false and section_status="not_applicable".</enrollment_gating>

            <phases>
                <phase name="impact">Phase 1 — Impact, Months 1–2. Short-term credit disruption as the debt cycle is interrupted. Scores may decline initially as enrolled accounts stop receiving payments. Framed as expected because creditors need to recognize the client is working toward resolution.</phase>
                <phase name="stabilization">Phase 2 — Stabilization, Months 4–8. Credit activity quiets while negotiations progress. Fewer new negative updates appear. "No news is good news."</phase>
                <phase name="recovery">Phase 3 — Recovery, Months 10–48. Resolved accounts begin strengthening the credit profile. Settled accounts report zero balances. Utilization drops, DTI improves.</phase>
                <phase name="rebuild">Phase 4 — Rebuild, Month 48+. Post-graduation credit rebuilding. With improved creditworthiness, the client focuses on strengthening credit health.</phase>
            </phases>

            <discussion_points>
                <point name="payments">Payments — Client funds go to a dedicated savings account in the client's name, NOT to Beyond Finance directly. The client can monitor it 24/7. During the first few months, creditors may charge additional fees, which are factored into the program cost. Coverage requires both the dedicated/client-owned-savings framing AND acknowledgement of early-month creditor fees (or equivalent — e.g., "creditors may add late fees in the beginning"). Mentioning only "you stop paying creditors" without the savings-account framing does NOT count.</point>
                <point name="creditor_calls">Creditor calls — The client should expect calls from creditors; these are normal. Beyond's team works with creditors directly, and call volume decreases as the program progresses. Coverage requires acknowledging that calls will happen AND that Beyond handles the communications / volume tapers. Generic "creditors might contact you" without the Beyond-handles-it framing does NOT count.</point>
                <point name="legal_action">Legal action — A small portion of accounts (~1-2%) may see legal action. If a creditor becomes aggressive, Beyond's Client Success team prioritizes that account. Coverage requires explicitly setting the expectation that legal action is possible AND that Beyond has a process for it. A bare "we'll handle anything that comes up" without naming legal action does NOT count.</point>
            </discussion_points>

            <score_framing_note>The current Skyfall slide frames credit impact softly: "clients entering the program typically see very little initial impact" and "by month 12, many report almost complete restoration." Do NOT require the agent to use harsh "your score will crash" language. Acknowledging short-term impact in the context of Phase 1 (Impact) is sufficient.</score_framing_note>

            <coverage_rules>
                <rule>Only the handling agent's statements count. Statements from a transfer/welcome agent (post-enrollment onboarding) do NOT count.</rule>
                <rule>Substance matters, not exact wording. The agent does not need to say "Phase 1" or "Impact" — describing the months 1–2 short-term credit disruption covers it. Same for the discussion points.</rule>
                <rule>A passing reference like "there are 4 phases" without walking through each phase's content does NOT cover the phases.</rule>
                <rule>A discussion point communicated ONLY inside the agent's ACDR/GOTA compliance script read-through does NOT count as covered. It must appear in the client-friendly pitch.</rule>
                <rule>If the content was delivered earlier in the call by the handling agent, it counts even if the agent didn't reopen the Program Expectations slide right before DocuSign.</rule>
            </coverage_rules>

            <section_status_rules>
                <rule>If enrollment_completed = false → section_status = "not_applicable".</rule>
                <rule>If enrollment_completed = true AND all four phases AND all three discussion points are covered → section_status = "pass".</rule>
                <rule>If enrollment_completed = true AND any phase or discussion point is missing → section_status = "fail". Populate missing_elements with human-readable strings (e.g., "Phase 2: Stabilization (Months 4–8)", "Discussion point: legal action").</rule>
                <rule>section_status = "fail" here MUST NOT by itself trigger manager_review_required. Alerts for missed program-expectations coverage are dispatched by the standalone program_expectations module.</rule>
            </section_status_rules>
        </program_expectations>
    </evaluation_criteria>

    <scoring_guidelines>
        <compliance>All compliance items are pass/fail. A single "fail" in compliance results in overall compliance failure.</compliance>
        <customer_experience>Use 4-point scale: excellent/good/fair/poor</customer_experience>
        <sales_process>Use complete/partial/missing for step completion</sales_process>
        <manager_escalation>Manager review required only for: (1) Multiple compliance violations (2+ failures), OR (2) Blatant negative customer treatment (severe infractions such as shouting, insults, or absolute refusal to hang up; do NOT flag for merely rude tone or guilt-tripping sales tactics)</manager_escalation>
    </scoring_guidelines>

    <range_words_policy>
        <purpose>Agents must utilize range words when pitching to clients. Avoid providing guarantees, even without using the word "guarantee". Range words help qualify outcomes and are compliant when they clearly indicate variability.</purpose>
        <accepted_range_words>Typically, Commonly, Mostly, Naturally, Routinely, Ordinarily, Mainly, Most often, Per usual, Approximately, About, Around, On average, Estimated, Projected, Roughly, Usually, Normally</accepted_range_words>
        <qualifying_phrases_examples>this can vary; depends on your situation; results vary; not guaranteed</qualifying_phrases_examples>
        <accepted_compliant_phrasing_examples>signs of recovery; get resolved; first step; become debt-free</accepted_compliant_phrasing_examples>
        <scoring_rules>
            <rule>Do NOT mark a "no_misleading_claims" failure solely because the agent used accepted range words.</rule>
            <rule>Do NOT penalize the agent for using accepted compliant phrasing examples (e.g., "signs of recovery", "resolved", "first step", "become debt-free") unless they are paired with an unqualified guarantee (certainty) or otherwise misleading claim.</rule>
            <rule>Still mark a failure if the agent communicates certainty (a promise/guarantee), even if a range word appears elsewhere in the conversation. Evaluate the full claim in context.</rule>
            <rule>When uncertain, prefer evidence-based interpretation: if the listener would reasonably interpret the statement as guaranteed/certain, score as FAIL; if it is clearly qualified/variable, score as PASS.</rule>
        </scoring_rules>
    </range_words_policy>

    <examples_range_words>
        <pass>Your program term is estimated at around 48 months, but this can vary.</pass>
        <pass>On average, clients reduce overall debt, though results vary by creditor and situation.</pass>
        <pass>Your projected savings from the program is about $15,000 (this can vary).</pass>
        <pass>Clients can see signs of recovery to their credit as accounts get resolved through the course of the program.</pass>
        <pass>Take your first step towards a debt-free future; many clients become debt-free in about 24–48 months (this can vary).</pass>
        <pass>A soft inquiry has no impact on your credit score. (Soft pulls do not affect credit — this is factually accurate and is NOT an outcome guarantee.)</pass>
        <pass>I can guarantee you there'll be no impact on your credit with the soft inquiry. (Unqualified soft-inquiry statements are accurate and permitted.)</pass>
        <fail>You will be out of debt in 48 months.</fail>
        <fail>I guarantee your debt will be settled at 50%.</fail>
        <fail>Your credit score will go up by 50 points in 2 months.</fail>
        <fail>Your credit score is going to go up in 3-6 months.</fail>
        <fail>Your accounts will be negotiated in 3 months.</fail>
        <fail>You won't receive any calls from the creditors.</fail>
        <fail>We will handle all the communication from your creditors.</fail>
        <fail>I'm certain all of your creditors will settle your debt.</fail>
        <fail>You should see all your debts settled in 48 months.</fail>
        <fail>It takes about 3-6 months to get your settlements in place. (Implies ALL settlements happen in that window; the compliant framing is that the FIRST settlement typically occurs in 3-6 months.)</fail>
    </examples_range_words>

    <forbidden_phrases>
        <purpose>These phrases are factually incorrect or misrepresent Pennie's program. They should ALWAYS be flagged as a "no_misleading_claims" failure regardless of context or qualifiers.</purpose>
        <phrase reason="Interest is not eliminated; it may continue to accrue during the program">"This program eliminates your interest"</phrase>
        <phrase reason="Interest is not reduced to zero; it may continue to accrue during the program">"Zero percent interest"</phrase>
        <phrase reason="Creditors may still report negative information; the program does not prevent this">"Doesn't blacklist you with creditors"</phrase>
        <phrase reason="The program is a form of debt relief; denying this misrepresents the service">"This isn't debt relief"</phrase>
        <phrase reason="The program involves debt settlement; denying this misrepresents the service">"This isn't debt settlement"</phrase>
    </forbidden_phrases>

    <critical_compliance_notes>
        <note>Pennie is NOT a lender - they work with a network of 1,000+ financial partners</note>
        <note>Credit pulls must be explicitly authorized with customer giving clear verbal affirmation (e.g., "yes", "I agree", "mhmm", "yeah", "sure", "okay", "go ahead"). The key requirement is that the agent ASKED for permission and the customer gave an affirmative response — not that specific magic words were used.</note>
        <note>Debt resolution is presented as education, not high-pressure sales</note>
        <note>All representations about savings, timelines, and outcomes must be realistic</note>
        <note>Range words are permitted and should NOT be penalized as guarantees when used to properly qualify outcomes (e.g., "estimated", "on average", "usually", "projected", "approximately", "around"). Evaluate the full statement: qualified/variable projections PASS; unqualified certainty/promise FAIL.</note>
        <note>Customer's financial situation should drive recommendations, not sales quotas</note>
        <note>Manager review only required for: Multiple compliance violations (2+ failures) OR blatant negative customer treatment</note>
        <note>Single compliance violations should be noted but do not automatically trigger manager review</note>
        <note>Focus manager escalation on serious patterns of violations or clear customer mistreatment</note>
        <note>Rebuttals regarding rental/credit impact (e.g., arguing debt is a bigger barrier than a temporary credit dip) are PERMITTED as standard sales tactics, provided they do not factually deny the impact</note>
        <note>Soft credit inquiries (soft pulls) do NOT impact credit scores. Unqualified agent statements to this effect — including categorical guarantees such as "a soft inquiry won't impact your credit", "there's no credit impact from a soft inquiry", or "I can guarantee no credit impact from the soft inquiry" — are FACTUALLY ACCURATE and MUST NOT be flagged as `no_misleading_claims`, `accurate_representations`, or `Outcome guarantee` violations. This carve-out applies ONLY to soft inquiries. Guarantees about hard inquiries, post-enrollment credit score changes, program-driven credit improvement, or general future credit score movement REMAIN compliance violations and must still be flagged per the range-words policy.</note>
        <note>Credit-reporting language carve-out: It is COMPLIANT for an agent to explain how settled accounts may appear on a customer's credit using the approved program-expectations framing — e.g., "it may appear on your credit as paid, paid as agreed, or settled as agreed." This is the exact language on Pennie's program-expectations slide and MUST NOT be flagged as a `no_misleading_claims` or `accurate_representations` violation. Only flag if the agent makes an unqualified factual claim that settled accounts WILL be reported as "paid as agreed" (i.e., presented as the guaranteed/sole reporting outcome rather than one possible way it may appear).</note>
        <note>Distinguish "High Pressure" from "Persistence": Persistence in overcoming objections is acceptable; High Pressure is hostility, insults, or ignoring explicit commands to stop/end the call</note>
        <note>Closing statements like "I hope you don't regret this" are sales tactics, not negative customer treatment, provided the agent ultimately respects the customer's decision and ends the call politely</note>
    </critical_compliance_notes>

    <critical_red_flags>
        <red_flag>Failure to obtain explicit credit pull consent</red_flag>
        <red_flag>Unqualified guarantees/promises of specific outcomes (e.g., debt resolution outcomes, savings, timelines, settlement %, or credit score improvements stated as certain). Qualified projections using accepted range words (estimated/on average/usually/etc.) are NOT red flags unless presented as guaranteed.</red_flag>
        <red_flag>Misrepresenting Pennie's program factuals (e.g., implying it is a government program or interest stops immediately) rather than just framing/positioning</red_flag>
        <red_flag>Hostile behavior or refusal to end the call after explicit rejection (standard objection handling and persistence are NOT red flags)</red_flag>
        <red_flag>Customer expressing confusion or misunderstanding without the agent providing clear clarification</red_flag>
    </critical_red_flags>

    <instructions>
        When analyzing a call transcript:
        1. Read the entire transcript carefully before scoring
        2. Focus primarily on compliance adherence - this is the most critical aspect
        3. Capture every piece of evidence using this structure: Speaker label (Agent/Customer/Transfer Agent/etc.), direct quote in quotation marks, contextual timing note (e.g., "after credit discussion"), and Pennie 6-step tag (Step 1 Agenda Setting, Step 2 Credit Review, Step 3 Agent Inputs, Step 4 Paydown Projections, Step 5 Loan Offers, Step 6 Debt Resolution, or Off-Cycle)
        4. Record exact quotes or clear contextual descriptions for every compliance requirement (pass or fail) using the evidence structure above
        5. Cross-check the transcript against Pennie's high-risk compliance checklist (credit pull consent, outcome guarantees, interest accrual accuracy, graduation loan positioning, compliant terminology, legal action framing, program regulation accuracy, GOTA script adherence, co-applicant approval) and document outcomes with structured evidence; if an item is not observed or not applicable, return an empty evidence array rather than null or omitting the field
        5a. Range words compliance: Do NOT penalize agents for using accepted range words (estimated/on average/usually/roughly/about/around/etc.) to qualify outcomes. Still flag unqualified certainty/promise. Evaluate the entire claim in context.
        5b. Forbidden phrases: Check the transcript for any forbidden phrases listed in the forbidden_phrases section. These are ALWAYS a "no_misleading_claims" failure regardless of context or qualifiers.
        6. Document specific quotes demonstrating customer experience quality (both positive and negative) using the same structure
        7. Note where in the conversation each sales process step occurs (e.g., "during opening", "after credit discussion") and align with the Pennie 6-step tags
        8. Evaluate customer treatment and experience quality with specific structured evidence
        9. Log which Pennie playbook sections were expected, which were attempted, and which were completed; clearly note any sections that were not reached and document the reason each expected section was not completed (e.g., call ended early, customer declined, agent skipped)
        10. Monitor for the critical red flags listed above and record any occurrences with structured evidence
        11. For every critical red flag observed, record a structured evidence entry and note the specific red-flag category triggered
        12. Assess adherence to Pennie's consultative sales methodology
        13. Evaluate *final compliance*: Did the agent eventually respect the customer's "no" and end the call? If yes, prior persistence should generally not be flagged as a "refusal to disengage" or high-pressure tactic
        14. Flag calls for manager review ONLY when there are multiple compliance violations (2+) OR blatant negative customer treatment (severe infractions like shouting, insults, or refusal to hang up)
        15. When flagging for manager review, clearly specify the reason and provide structured evidence entries the manager should focus on
        16. Single compliance violations should be documented but do not automatically require manager review
        17. Be objective and fair in your assessment while maintaining high standards
        18. Remember that protecting customers and maintaining compliance is more important than sales outcomes
        19. Always provide specific quotes or clear references to conversation sections as evidence for your assessments
    </instructions>
    <prior_call_context>
        <note>The user prompt may include a &lt;prior_call_history&gt; block before the transcript. This contains summaries of previous calls with the same lead.</note>
        <note>When prior call history is present, this is NOT the first interaction with the lead. The agent may reference prior conversations, skip introductory steps already completed, or follow up on previous topics.</note>
        <note>Do not penalize the agent for skipping sales process steps (e.g., agenda setting, credit review) that were completed on a prior call. Mark such steps as "missing" with a note that they were handled previously, but do not count them as compliance failures or negative performance indicators.</note>
        <note>Compliance requirements that must be met on EVERY call (e.g., credit pull consent for a new credit pull) should still be evaluated normally regardless of prior call history.</note>
        <note>If no &lt;prior_call_history&gt; block is present, evaluate the call as a standalone interaction.</note>
    </prior_call_context>
</prompt>

Respond with a valid JSON object using exactly these top-level keys:

- "call_overview": Call metadata — speakers, topic, purpose, outcome, tone, manager review flags
- "compliance_scorecard": Pass/fail compliance checks with evidence arrays
- "customer_experience_scorecard": 4-point scale ratings (excellent/good/fair/poor) for each CX criterion
- "sales_process_scorecard": 6-step sales process adherence — step completion, locations, gaps
- "program_expectations_scorecard": Program-expectations coverage on enrolled calls (phases + downsides) — see schema below
- "transfer_agent_assessment": Transfer agent evaluation (occurred, tone, quality)
- "coaching_recommendations": Strengths, areas for improvement, coaching points, training recommendations
- "overall_call_rating": Final summary ratings — compliance, sales effectiveness, customer satisfaction, overall score

The "program_expectations_scorecard" object MUST contain exactly these keys:
- "enrollment_completed" (boolean)
- "enrollment_evidence_quote" (string; empty if not enrolled)
- "phase_impact_covered" (boolean)
- "phase_impact_evidence" (string; empty if not covered)
- "phase_stabilization_covered" (boolean)
- "phase_stabilization_evidence" (string)
- "phase_recovery_covered" (boolean)
- "phase_recovery_evidence" (string)
- "phase_rebuild_covered" (boolean)
- "phase_rebuild_evidence" (string)
- "payments_point_covered" (boolean)
- "payments_point_evidence" (string)
- "creditor_calls_point_covered" (boolean)
- "creditor_calls_point_evidence" (string)
- "legal_action_point_covered" (boolean)
- "legal_action_point_evidence" (string)
- "missing_elements" (array of human-readable strings; empty array if section_status != "fail")
- "section_status" ("pass" | "fail" | "not_applicable")
- "section_summary" (string; one-sentence summary of coverage for the scorecard)

Do not include any text outside the JSON.$full_qa_prompt$,
  $manifest$[{"key":"call_recording_disclosure","label":"Call recording disclosure","section":"Compliance","rule":"Was the required call-recording disclosure present?","score_path":"compliance_scorecard.call_recording_disclosure","evidence_path":"compliance_scorecard.call_recording_disclosure_evidence","domain":["pass","fail","not_applicable"],"finding_category":"compliance"},{"key":"credit_pull_consent","label":"Credit pull consent","section":"Compliance","rule":"Did the agent obtain verbal consent before pulling credit? The agent should ask for permission (e.g., \"Do I have your permission to pull your credit?\") and the customer must give a clear affirmative response (e.g., \"yes\", \"mhmm\", \"yeah\", \"sure\", \"okay\"). Any recognizable verbal affirmative counts as consent.","score_path":"compliance_scorecard.credit_pull_consent","evidence_path":"compliance_scorecard.credit_pull_consent_evidence","domain":["pass","fail","not_applicable"],"finding_category":"compliance"},{"key":"social_security_verification","label":"Social security verification","section":"Compliance","rule":"Did the agent properly request and verify SSN for security purposes?","score_path":"compliance_scorecard.social_security_verification","evidence_path":"compliance_scorecard.social_security_verification_evidence","domain":["pass","fail","not_applicable"],"finding_category":"compliance"},{"key":"accurate_representations","label":"Accurate representations","section":"Compliance","rule":"Did the agent make only truthful statements about Pennie's services, processes, and potential outcomes?","score_path":"compliance_scorecard.accurate_representations","evidence_path":"compliance_scorecard.accurate_representations_violations","domain":["pass","fail"],"finding_category":"compliance"},{"key":"no_misleading_claims","label":"No misleading claims","section":"Compliance","rule":"Did the agent avoid making misleading promises/guarantees about outcomes (e.g., savings, timelines, settlement %, credit impact), while allowing appropriately qualified estimates/projections (e.g., \"estimated\", \"on average\", \"usually\", \"roughly\", \"this can vary\")?","score_path":"compliance_scorecard.no_misleading_claims","evidence_path":"compliance_scorecard.misleading_claims_violations","domain":["pass","fail"],"finding_category":"compliance"},{"key":"professional_tone","label":"Professional tone","section":"Customer experience","rule":"Was the agent respectful, courteous, and professional throughout?","score_path":"customer_experience_scorecard.professional_tone","evidence_path":"customer_experience_scorecard.professional_tone_examples","domain":["excellent","good","fair","poor"],"finding_category":"customer_experience"},{"key":"active_listening","label":"Active listening","section":"Customer experience","rule":"Did the agent demonstrate active listening and respond appropriately to customer concerns?","score_path":"customer_experience_scorecard.active_listening","evidence_path":"customer_experience_scorecard.active_listening_examples","domain":["excellent","good","fair","poor"],"finding_category":"customer_experience"},{"key":"patience_empathy","label":"Patience and empathy","section":"Customer experience","rule":"Did the agent show patience and empathy when discussing financial difficulties?","score_path":"customer_experience_scorecard.patience_empathy","evidence_path":"customer_experience_scorecard.patience_empathy_examples","domain":["excellent","good","fair","poor"],"finding_category":"customer_experience"},{"key":"clear_communication","label":"Clear communication","section":"Customer experience","rule":"Did the agent explain concepts clearly and avoid confusing jargon?","score_path":"customer_experience_scorecard.clear_communication","evidence_path":"customer_experience_scorecard.clear_communication_examples","domain":["excellent","good","fair","poor"],"finding_category":"customer_experience"},{"key":"customer_focused","label":"Customer focused","section":"Customer experience","rule":"Did the agent prioritize the customer's best interests over sales pressure?","score_path":"customer_experience_scorecard.customer_focused","evidence_path":"customer_experience_scorecard.customer_focused_examples","domain":["excellent","good","fair","poor"],"finding_category":"customer_experience"},{"key":"step1_agenda_setting","label":"Step 1 — Agenda setting and credit pull","section":"Sales process","rule":"Set clear expectations for call duration and topics; obtained proper credit pull authorization; used required \"Does that sound fair?\" language.","score_path":"sales_process_scorecard.step1_agenda_setting","evidence_path":"sales_process_scorecard.step1_location","domain":["complete","partial","missing"],"finding_category":"sales_process"},{"key":"step2_credit_review","label":"Step 2 — Credit review and analysis","section":"Sales process","rule":"Properly reviewed credit report for eligible/ineligible debt; identified relevant credit trends; explained findings in an educational manner.","score_path":"sales_process_scorecard.step2_credit_review","evidence_path":"sales_process_scorecard.step2_location","domain":["complete","partial","missing","not_applicable"],"finding_category":"sales_process"},{"key":"step3_agent_inputs","label":"Step 3 — Agent inputs and DTI","section":"Sales process","rule":"Collected all required data points accurately; calculated DTI ratio correctly; explained cash flow analysis clearly.","score_path":"sales_process_scorecard.step3_agent_inputs","evidence_path":"sales_process_scorecard.step3_location","domain":["complete","partial","missing"],"finding_category":"sales_process"},{"key":"step4_paydown_projections","label":"Step 4 — Paydown projections","section":"Sales process","rule":"Presented meaningful creditworthiness timeline; showed impact of minimum payments vs. resolution; used data to educate rather than pressure.","score_path":"sales_process_scorecard.step4_paydown_projections","evidence_path":"sales_process_scorecard.step4_location","domain":["complete","partial","missing","not_applicable"],"finding_category":"sales_process"},{"key":"step5_offers_review","label":"Step 5 — Offers review","section":"Sales process","rule":"Reviewed available offers or denials appropriately; transitioned naturally to resolution discussion.","score_path":"sales_process_scorecard.step5_offers_review","evidence_path":"sales_process_scorecard.step5_location","domain":["complete","partial","missing","not_applicable"],"finding_category":"sales_process"},{"key":"step6_debt_resolution","label":"Step 6 — Debt resolution","section":"Sales process","rule":"Presented resolution as education, not high-pressure sales; explained program benefits and considerations clearly; answered questions thoroughly and honestly.","score_path":"sales_process_scorecard.step6_debt_resolution","evidence_path":"sales_process_scorecard.step6_location","domain":["complete","partial","missing","not_applicable"],"finding_category":"sales_process"},{"key":"phase_impact_covered","label":"Phase 1 — Impact","section":"Program expectations","rule":"Phase 1 — Impact, Months 1–2. Short-term credit disruption as the debt cycle is interrupted. Scores may decline initially as enrolled accounts stop receiving payments. Framed as expected because creditors need to recognize the client is working toward resolution.","score_path":"program_expectations_scorecard.phase_impact_covered","evidence_path":"program_expectations_scorecard.phase_impact_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"phase_stabilization_covered","label":"Phase 2 — Stabilization","section":"Program expectations","rule":"Phase 2 — Stabilization, Months 4–8. Credit activity quiets while negotiations progress. Fewer new negative updates appear. \"No news is good news.\"","score_path":"program_expectations_scorecard.phase_stabilization_covered","evidence_path":"program_expectations_scorecard.phase_stabilization_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"phase_recovery_covered","label":"Phase 3 — Recovery","section":"Program expectations","rule":"Phase 3 — Recovery, Months 10–48. Resolved accounts begin strengthening the credit profile. Settled accounts report zero balances. Utilization drops, DTI improves.","score_path":"program_expectations_scorecard.phase_recovery_covered","evidence_path":"program_expectations_scorecard.phase_recovery_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"phase_rebuild_covered","label":"Phase 4 — Rebuild","section":"Program expectations","rule":"Phase 4 — Rebuild, Month 48+. Post-graduation credit rebuilding. With improved creditworthiness, the client focuses on strengthening credit health.","score_path":"program_expectations_scorecard.phase_rebuild_covered","evidence_path":"program_expectations_scorecard.phase_rebuild_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"payments_point_covered","label":"Discussion point — Payments","section":"Program expectations","rule":"Payments — Client funds go to a dedicated savings account in the client's name, NOT to Beyond Finance directly. The client can monitor it 24/7. During the first few months, creditors may charge additional fees, which are factored into the program cost.","score_path":"program_expectations_scorecard.payments_point_covered","evidence_path":"program_expectations_scorecard.payments_point_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"creditor_calls_point_covered","label":"Discussion point — Creditor calls","section":"Program expectations","rule":"Creditor calls — The client should expect calls from creditors; these are normal. Beyond's team works with creditors directly, and call volume decreases as the program progresses.","score_path":"program_expectations_scorecard.creditor_calls_point_covered","evidence_path":"program_expectations_scorecard.creditor_calls_point_evidence","domain":[true,false],"finding_category":"program_expectations"},{"key":"legal_action_point_covered","label":"Discussion point — Legal action","section":"Program expectations","rule":"Legal action — A small portion of accounts (~1-2%) may see legal action. If a creditor becomes aggressive, Beyond's Client Success team prioritizes that account.","score_path":"program_expectations_scorecard.legal_action_point_covered","evidence_path":"program_expectations_scorecard.legal_action_point_evidence","domain":[true,false],"finding_category":"program_expectations"}]$manifest$::jsonb
);

create table public.eavesly_full_qa_review_revisions (
  call_id text not null,
  module_name text not null check (module_name = 'full_qa'),
  feedback_revision integer not null check (feedback_revision > 0),
  source_result_json jsonb not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_prompt_sha256 text,
  rubric_reference_prompt_sha256 text not null references public.eavesly_full_qa_rubric_catalog(prompt_sha256),
  source_reference_kind text not null check (source_reference_kind in ('known','legacy_current_reference','unknown_hash')),
  corrections jsonb not null check (jsonb_typeof(corrections) = 'array' and jsonb_array_length(corrections) = 23),
  findings jsonb not null check (jsonb_typeof(findings) = 'array'),
  escalation_justified boolean not null,
  escalation_reason text not null,
  escalation_inaccuracy_reason text,
  action_taken text check (action_taken in ('coached','escalated','follow_up_later','no_action_needed')),
  action_details text,
  saved_by text not null,
  saved_at timestamptz not null default now(),
  primary key (call_id, module_name, feedback_revision),
  foreign key (call_id, module_name) references public.eavesly_alert_feedback(call_id, module_name)
);
create index eavesly_full_qa_review_saved_idx on public.eavesly_full_qa_review_revisions(saved_by, saved_at desc);

create table public.eavesly_full_qa_rule_proposals (
  id bigserial primary key,
  call_id text not null,
  module_name text not null check (module_name = 'full_qa'),
  feedback_revision integer not null check (feedback_revision > 0),
  criterion_key text not null,
  proposed_rule text not null,
  why text not null,
  source_prompt_sha256 text not null references public.eavesly_full_qa_rubric_catalog(prompt_sha256),
  source_current_criterion jsonb not null,
  proposed_by text not null,
  proposed_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending','accepted_for_evaluation','rejected')),
  decided_by text,
  decided_at timestamptz,
  decision_reason text,
  constraint eavesly_full_qa_rule_proposal_review_fk foreign key(call_id,module_name,feedback_revision)
    references public.eavesly_full_qa_review_revisions(call_id,module_name,feedback_revision),
  constraint eavesly_full_qa_rule_proposal_decision_shape check (
    (decision='pending' and decided_by is null and decided_at is null and decision_reason is null)
    or (decision in ('accepted_for_evaluation','rejected') and decided_by is not null and decided_at is not null
      and decision_reason is not null and char_length(private.trim_internal_review_text(decision_reason)) between 12 and 4000)
  )
);

alter table public.eavesly_full_qa_rubric_catalog enable row level security;
alter table public.eavesly_full_qa_review_revisions enable row level security;
alter table public.eavesly_full_qa_rule_proposals enable row level security;
revoke all on public.eavesly_full_qa_rubric_catalog, public.eavesly_full_qa_review_revisions,
  public.eavesly_full_qa_rule_proposals from public, anon, authenticated;
revoke all on sequence public.eavesly_full_qa_rule_proposals_id_seq from public, anon, authenticated;

create or replace function private.full_qa_reject_immutable_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception using errcode='P0001', message='EAVESLY_FULL_QA_IMMUTABLE';
end $$;
revoke all on function private.full_qa_reject_immutable_mutation() from public, anon, authenticated;
create trigger eavesly_full_qa_catalog_immutable before update or delete on public.eavesly_full_qa_rubric_catalog
for each row execute function private.full_qa_reject_immutable_mutation();

create or replace function private.full_qa_guard_catalog_insert()
returns trigger language plpgsql set search_path='' as $$
begin
  if encode(extensions.digest(convert_to(new.prompt_text,'UTF8'),'sha256'),'hex') <> new.prompt_sha256
    or jsonb_array_length(new.criteria_manifest) <> 23
    or (select count(distinct criterion->>'key') from jsonb_array_elements(new.criteria_manifest) criterion) <> 23
    or exists(select 1 from jsonb_array_elements(new.criteria_manifest) criterion
      where jsonb_typeof(criterion) <> 'object'
        or not (criterion ?& array['key','label','section','rule','score_path','evidence_path','domain','finding_category'])
        or jsonb_typeof(criterion->'domain') <> 'array') then
    raise exception using errcode='P0001', message='EAVESLY_INVALID_FULL_QA_CATALOG';
  end if;
  return new;
end $$;
revoke all on function private.full_qa_guard_catalog_insert() from public, anon, authenticated;
create trigger eavesly_full_qa_catalog_insert_guard before insert on public.eavesly_full_qa_rubric_catalog
for each row execute function private.full_qa_guard_catalog_insert();

do $$
begin
  if exists(select 1 from public.eavesly_full_qa_rubric_catalog c
    where encode(extensions.digest(convert_to(c.prompt_text,'UTF8'),'sha256'),'hex') <> c.prompt_sha256) then
    raise exception using errcode='P0001', message='EAVESLY_INVALID_FULL_QA_CATALOG';
  end if;
end $$;

create trigger eavesly_full_qa_review_immutable before update or delete on public.eavesly_full_qa_review_revisions
for each row execute function private.full_qa_reject_immutable_mutation();

create or replace function private.full_qa_feedback_rpc_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.module_name='full_qa' and coalesce(current_setting('eavesly.full_qa_write',true),'') <> 'allowed' then
    raise exception using errcode='P0001', message='EAVESLY_FULL_QA_USE_STRUCTURED_RPC';
  end if;
  return new;
end $$;
revoke all on function private.full_qa_feedback_rpc_only() from public, anon, authenticated;
create trigger full_qa_feedback_rpc_only before insert or update on public.eavesly_alert_feedback
for each row execute function private.full_qa_feedback_rpc_only();

alter table public.eavesly_alert_feedback drop constraint eavesly_alert_feedback_action_xor;
alter table public.eavesly_alert_feedback add constraint eavesly_alert_feedback_action_xor check (
  module_name = 'full_qa' or not (action_taken is not null and inaccuracy_reason is not null)
) not valid;
alter table public.eavesly_alert_feedback drop constraint eavesly_alert_feedback_structured_complete;
alter table public.eavesly_alert_feedback add constraint eavesly_alert_feedback_structured_complete check (
  module_name in ('disposition_review','achieve_welcome_call_qa','full_qa')
  or (accurate and action_taken is not null and inaccuracy_reason is null and comment is null
    and violation_details is not null and action_details is not null
    and char_length(private.trim_internal_review_text(violation_details)) between 12 and 4000
    and char_length(private.trim_internal_review_text(action_details)) between 12 and 4000
    and lower(private.trim_internal_review_text(violation_details)) <> lower(private.trim_internal_review_text(action_details)))
  or (not accurate and action_taken is null and inaccuracy_reason is not null and violation_details is null
    and action_details is null and comment is not null
    and char_length(private.trim_internal_review_text(comment)) between 12 and 4000)
) not valid;

create or replace function private.full_qa_fingerprint(p_json jsonb)
returns text language sql immutable strict set search_path='' as $$
  select encode(extensions.digest(convert_to(p_json::text,'UTF8'),'sha256'),'hex')
$$;
revoke all on function private.full_qa_fingerprint(jsonb) from public, anon, authenticated;

create or replace function private.full_qa_prompt_hash(p_source jsonb)
returns text language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_source->'_evaluation_provenance')='object'
    and (select count(*) from jsonb_object_keys(p_source->'_evaluation_provenance'))=5
    and p_source->'_evaluation_provenance'->>'version'='1'
    and p_source->'_evaluation_provenance'->>'module_name'='full_qa'
    and p_source->'_evaluation_provenance'->>'prompt_sha256' ~ '^[0-9a-f]{64}$'
    and p_source->'_evaluation_provenance'->>'user_prompt_sha256' ~ '^[0-9a-f]{64}$'
    and p_source->'_evaluation_provenance'->>'transcript_sha256' ~ '^[0-9a-f]{64}$'
    then p_source->'_evaluation_provenance'->>'prompt_sha256' end
$$;
revoke all on function private.full_qa_prompt_hash(jsonb) from public, anon, authenticated;

create or replace function private.full_qa_validate_review(
  p_source jsonb, p_manifest jsonb, p_corrections jsonb, p_findings jsonb,
  p_escalation boolean, p_reason text, p_inaccuracy_reason text,
  p_action text, p_action_details text
) returns boolean language plpgsql immutable set search_path='' as $$
declare
  v_reason text := nullif(private.trim_internal_review_text(p_reason),'');
  v_action_details text := nullif(private.trim_internal_review_text(p_action_details),'');
  v_findings integer;
begin
  if p_source is null or p_manifest is null or p_corrections is null or p_findings is null or p_escalation is null
    or jsonb_typeof(p_corrections) is distinct from 'array' or jsonb_array_length(p_corrections)<>23
    or jsonb_typeof(p_findings) is distinct from 'array' or v_reason is null or char_length(v_reason) not between 12 and 4000 then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(p_corrections)) <> (select count(distinct c->>'criterion_key') from jsonb_array_elements(p_corrections)c)
    or exists (
      select 1 from jsonb_array_elements(p_corrections)c
      left join jsonb_array_elements(p_manifest)m on m->>'key'=c->>'criterion_key'
      where m is null or jsonb_typeof(c)<>'object' or (select count(*) from jsonb_object_keys(c))<>4
        or not (c ?& array['criterion_key','disposition','corrected_value','reason'])
        or c->>'criterion_key' is null or c->>'disposition' is null
        or c->>'disposition' not in ('confirmed','corrected','needs_context')
        or case c->>'disposition'
          when 'confirmed' then c->'corrected_value' is distinct from (p_source #> string_to_array(m->>'score_path','.')) or c->'reason'<>'null'::jsonb
          when 'corrected' then c->'corrected_value' is not distinct from (p_source #> string_to_array(m->>'score_path','.'))
            or not ((m->'domain') @> jsonb_build_array(c->'corrected_value'))
            or jsonb_typeof(c->'reason') is distinct from 'string' or char_length(private.trim_internal_review_text(c->>'reason')) not between 12 and 4000
          else c->'corrected_value'<>'null'::jsonb or jsonb_typeof(c->'reason') is distinct from 'string'
            or char_length(private.trim_internal_review_text(c->>'reason')) not between 12 and 4000 end
    ) then return false; end if;
  v_findings:=jsonb_array_length(p_findings);
  if (select count(distinct f->>'finding_id') from jsonb_array_elements(p_findings) f) <> v_findings then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_findings)f
    where jsonb_typeof(f)<>'object' or (select count(*) from jsonb_object_keys(f))<>5
      or not (f ?& array['finding_id','category','related_criteria','summary','evidence'])
      or coalesce(f->>'finding_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or f->>'finding_id' is null or f->>'category' is null
      or f->>'category' not in ('compliance','customer_experience','sales_process','program_expectations','severe_customer_mistreatment')
      or jsonb_typeof(f->'related_criteria') is distinct from 'array' or jsonb_array_length(f->'related_criteria')<1
      or (select count(*) from jsonb_array_elements_text(f->'related_criteria')) <> (select count(distinct x) from jsonb_array_elements_text(f->'related_criteria')x)
      or exists(select 1 from jsonb_array_elements_text(f->'related_criteria')x where not exists(select 1 from jsonb_array_elements(p_manifest)m where m->>'key'=x))
      or jsonb_typeof(f->'summary') is distinct from 'string' or char_length(private.trim_internal_review_text(f->>'summary')) not between 12 and 4000
      or jsonb_typeof(f->'evidence') is distinct from 'string' or char_length(private.trim_internal_review_text(f->>'evidence')) not between 12 and 4000
  ) then return false; end if;
  if p_escalation and not (
    exists(select 1 from jsonb_array_elements(p_findings)f where f->>'category'='severe_customer_mistreatment')
    or (select count(*) from jsonb_array_elements(p_findings)f where f->>'category'='compliance')>=2
  ) then return false; end if;
  if (p_escalation and p_inaccuracy_reason is not null) or (not p_escalation and (p_inaccuracy_reason is null or p_inaccuracy_reason not in (
    'soft_inquiry_misclassified','wrong_context','evidence_misquoted','policy_does_not_apply','addressed_off_call','covered_not_verbatim','call_dropped_incomplete','other'))) then return false; end if;
  if (v_findings=0 and (p_action is not null or v_action_details is not null))
    or (v_findings>0 and (p_action is null or p_action not in ('coached','escalated','follow_up_later','no_action_needed')
      or v_action_details is null or char_length(v_action_details) not between 12 and 4000)) then return false; end if;
  return true;
end $$;
revoke all on function private.full_qa_validate_review(jsonb,jsonb,jsonb,jsonb,boolean,text,text,text,text) from public, anon, authenticated;

create or replace function public.submit_full_qa_review(
  p_call_id text, p_expected_revision integer, p_expected_decision_id bigint,
  p_expected_source_fingerprint text, p_corrections jsonb, p_findings jsonb,
  p_escalation_justified boolean, p_escalation_reason text, p_inaccuracy_reason text,
  p_action text, p_action_details text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor text:=private.internal_alert_actor_email(); v_agent text; v_feedback public.eavesly_alert_feedback%rowtype;
  v_has_feedback boolean:=false; v_current_decision bigint; v_source jsonb; v_fingerprint text; v_prompt_hash text;
  v_kind text; v_manifest jsonb; v_reference_hash text; v_revision public.eavesly_full_qa_review_revisions%rowtype;
begin
  if p_expected_revision is null or p_expected_revision<0 or p_expected_source_fingerprint is null
    or p_expected_source_fingerprint !~ '^[0-9a-f]{64}$' or p_corrections is null or p_findings is null then
    raise exception using errcode='P0001',message='EAVESLY_INVALID_FULL_QA_REVIEW'; end if;
  select m.agent_email,m.result_json into v_agent,v_source from public.eavesly_module_results m
    where m.call_id=p_call_id and m.module_name='full_qa' and m.alert_sent=true order by m.id limit 1 for update;
  if not found then raise exception using errcode='P0001',message='EAVESLY_ALERT_NOT_FOUND'; end if;
  if not exists(select 1 from public.manager_coaching_prompts p where lower(p.manager_email)=v_actor and p.is_god_mode)
    and not exists(select 1 from public.agent_manager_mapping a where lower(a.agent_email)=lower(v_agent) and lower(a.manager_email)=v_actor)
    then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  select f.* into v_feedback from public.eavesly_alert_feedback f where f.call_id=p_call_id and f.module_name='full_qa' for update;
  v_has_feedback:=found;
  if v_has_feedback then
    select r.* into v_revision from public.eavesly_full_qa_review_revisions r where r.call_id=p_call_id and r.module_name='full_qa' and r.feedback_revision=v_feedback.review_revision;
    if found then v_source:=v_revision.source_result_json; end if;
    select d.id into v_current_decision from public.eavesly_alert_review_decisions d where d.call_id=p_call_id and d.module_name='full_qa' and d.feedback_revision=v_feedback.review_revision;
  end if;
  v_fingerprint:=private.full_qa_fingerprint(v_source);
  if v_fingerprint<>p_expected_source_fingerprint then raise exception using errcode='P0001',message='EAVESLY_STALE_FULL_QA_SOURCE'; end if;
  v_prompt_hash:=private.full_qa_prompt_hash(v_source);
  select c.criteria_manifest,c.prompt_sha256 into v_manifest,v_reference_hash from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_prompt_hash;
  if v_manifest is not null then v_kind:='known';
  elsif v_prompt_hash is null then select c.criteria_manifest,c.prompt_sha256 into v_manifest,v_reference_hash from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by c.contract_version desc limit 1; v_kind:='legacy_current_reference';
  else select c.criteria_manifest,c.prompt_sha256 into v_manifest,v_reference_hash from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by c.contract_version desc limit 1; v_kind:='unknown_hash'; end if;
  if not private.full_qa_validate_review(v_source,v_manifest,p_corrections,p_findings,p_escalation_justified,
    p_escalation_reason,p_inaccuracy_reason,p_action,p_action_details) then
    raise exception using errcode='P0001',message='EAVESLY_INVALID_FULL_QA_REVIEW'; end if;
  -- Exact replay after a lost response; an approval or different payload is never overwritten.
  if v_has_feedback and v_feedback.review_revision=p_expected_revision+1 and v_current_decision is null
    and v_revision.saved_by=v_actor and v_revision.source_fingerprint=v_fingerprint
    and v_revision.corrections=p_corrections and v_revision.findings=p_findings
    and v_revision.escalation_justified=p_escalation_justified
    and v_revision.escalation_reason=private.trim_internal_review_text(p_escalation_reason)
    and v_revision.escalation_inaccuracy_reason is not distinct from p_inaccuracy_reason
    and v_feedback.inaccuracy_reason is not distinct from p_inaccuracy_reason
    and v_revision.action_taken is not distinct from p_action
    and v_revision.action_details is not distinct from nullif(private.trim_internal_review_text(p_action_details),'') then
      return jsonb_build_object('feedback_id',v_feedback.id,'review_revision',v_feedback.review_revision,
        'reviewed_at',v_revision.saved_at,'idempotent',true); end if;
  if (not v_has_feedback and (p_expected_revision<>0 or p_expected_decision_id is not null))
    or (v_has_feedback and (v_feedback.review_revision<>p_expected_revision or v_current_decision is distinct from p_expected_decision_id)) then
    raise exception using errcode='P0001',message='EAVESLY_STALE_REVIEW'; end if;
  perform set_config('eavesly.full_qa_write','allowed',true);
  if not v_has_feedback then
    insert into public.eavesly_alert_feedback(call_id,module_name,manager_email,accurate,action_taken,inaccuracy_reason,comment,violation_details,action_details)
    values(p_call_id,'full_qa',v_actor,p_escalation_justified,p_action,p_inaccuracy_reason,
      case when not p_escalation_justified then private.trim_internal_review_text(p_escalation_reason) end,
      private.trim_internal_review_text(p_escalation_reason),nullif(private.trim_internal_review_text(p_action_details),''))
    returning * into v_feedback;
  else
    update public.eavesly_alert_feedback set accurate=p_escalation_justified,action_taken=p_action,inaccuracy_reason=p_inaccuracy_reason,
      comment=case when not p_escalation_justified then private.trim_internal_review_text(p_escalation_reason) end,
      violation_details=private.trim_internal_review_text(p_escalation_reason),action_details=nullif(private.trim_internal_review_text(p_action_details),'')
    where id=v_feedback.id returning * into v_feedback;
  end if;
  insert into public.eavesly_full_qa_review_revisions(call_id,module_name,feedback_revision,source_result_json,source_fingerprint,
    source_prompt_sha256,rubric_reference_prompt_sha256,source_reference_kind,corrections,findings,escalation_justified,escalation_reason,
    escalation_inaccuracy_reason,action_taken,action_details,saved_by)
  values(p_call_id,'full_qa',v_feedback.review_revision,v_source,v_fingerprint,v_prompt_hash,
    v_reference_hash,v_kind,p_corrections,p_findings,
    p_escalation_justified,private.trim_internal_review_text(p_escalation_reason),p_inaccuracy_reason,p_action,nullif(private.trim_internal_review_text(p_action_details),''),v_actor)
  returning saved_at into v_revision.saved_at;
  if p_expected_decision_id is not null then
    insert into public.eavesly_alert_messages(call_id,module_name,author_email,body,requires_acknowledgment)
    values(p_call_id,'full_qa',v_actor,'Submitted revision '||v_feedback.review_revision||' for re-approval.',false); end if;
  return jsonb_build_object('feedback_id',v_feedback.id,'review_revision',v_feedback.review_revision,
    'reviewed_at',v_revision.saved_at,'idempotent',false);
end $$;

create or replace function public.get_full_qa_review_context(p_call_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor text:=private.internal_alert_actor_email(); v_result jsonb; v_feedback public.eavesly_alert_feedback%rowtype;
  v_review public.eavesly_full_qa_review_revisions%rowtype; v_hash text; v_catalog public.eavesly_full_qa_rubric_catalog%rowtype;
  v_kind text; v_proposals jsonb;
begin
  if not private.alert_visible_to(v_actor,p_call_id,'full_qa') then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  select m.result_json into v_result from public.eavesly_module_results m where m.call_id=p_call_id and m.module_name='full_qa' and m.alert_sent=true order by m.id limit 1;
  if not found then raise exception using errcode='P0001',message='EAVESLY_ALERT_NOT_FOUND'; end if;
  select f.* into v_feedback from public.eavesly_alert_feedback f where f.call_id=p_call_id and f.module_name='full_qa';
  if found then select r.* into v_review from public.eavesly_full_qa_review_revisions r where r.call_id=p_call_id and r.module_name='full_qa' and r.feedback_revision=v_feedback.review_revision;
    if found then v_result:=v_review.source_result_json; end if; end if;
  v_hash:=private.full_qa_prompt_hash(v_result);
  if v_review.call_id is not null then
    select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_review.rubric_reference_prompt_sha256;
    v_kind:=v_review.source_reference_kind;
  else
    select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_hash;
    if found then v_kind:='known';
    elsif v_hash is null then select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by contract_version desc limit 1; v_kind:='legacy_current_reference';
    else select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.module_name='full_qa' order by contract_version desc limit 1; v_kind:='unknown_hash'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'criterion_key',p.criterion_key,'proposed_rule',p.proposed_rule,'why',p.why,
    'source_prompt_sha256',p.source_prompt_sha256,'source_current_criterion',p.source_current_criterion,'proposed_by',p.proposed_by,
    'proposed_at',p.proposed_at,'decision',p.decision,'decided_by',p.decided_by,'decided_at',p.decided_at,'decision_reason',p.decision_reason)
    order by p.proposed_at,p.id),'[]'::jsonb) into v_proposals from public.eavesly_full_qa_rule_proposals p where p.call_id=p_call_id and p.module_name='full_qa';
  return jsonb_build_object('source_fingerprint',private.full_qa_fingerprint(v_result),'source_result_json',v_result,
    'source_prompt_sha256',v_hash,'source_reference_kind',v_kind,'reference_prompt_sha256',v_catalog.prompt_sha256,
    'criteria_reference_kind',case when v_kind='known' then 'exact_evaluation_rubric' when v_kind='legacy_current_reference' then 'current_reference_only' else 'current_field_map_only' end,
    'rubric_prompt_text',case when v_kind='unknown_hash' then null else v_catalog.prompt_text end,
    'criteria_manifest',v_catalog.criteria_manifest,'review',case when v_review.call_id is null then null else jsonb_build_object(
      'feedback_revision',v_review.feedback_revision,'corrections',v_review.corrections,'findings',v_review.findings,
      'escalation_justified',v_review.escalation_justified,'escalation_reason',v_review.escalation_reason,
      'escalation_inaccuracy_reason',v_review.escalation_inaccuracy_reason,
      'action_taken',v_review.action_taken,'action_details',v_review.action_details,'saved_by',v_review.saved_by,'saved_at',v_review.saved_at) end,
    'proposals',v_proposals);
end $$;

create or replace function public.propose_full_qa_rule(p_call_id text,p_feedback_revision integer,p_criterion_key text,p_proposed_rule text,p_why text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor text:=private.internal_alert_actor_email(); v_catalog public.eavesly_full_qa_rubric_catalog%rowtype; v_review public.eavesly_full_qa_review_revisions%rowtype; v_criterion jsonb; v_id bigint; v_at timestamptz;
begin
  if not private.alert_visible_to(v_actor,p_call_id,'full_qa') then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  select r.* into v_review from public.eavesly_full_qa_review_revisions r
    join public.eavesly_alert_feedback f on f.call_id=r.call_id and f.module_name=r.module_name and f.review_revision=r.feedback_revision
    where r.call_id=p_call_id and r.module_name='full_qa' and r.feedback_revision=p_feedback_revision;
  if not found or char_length(private.trim_internal_review_text(p_proposed_rule)) not between 12 and 4000
    or char_length(private.trim_internal_review_text(p_why)) not between 12 and 4000 then raise exception using errcode='P0001',message='EAVESLY_INVALID_RULE_PROPOSAL'; end if;
  select c.* into v_catalog from public.eavesly_full_qa_rubric_catalog c where c.prompt_sha256=v_review.rubric_reference_prompt_sha256;
  select m into v_criterion from jsonb_array_elements(v_catalog.criteria_manifest)m where m->>'key'=p_criterion_key;
  if v_criterion is null then raise exception using errcode='P0001',message='EAVESLY_INVALID_RULE_PROPOSAL'; end if;
  insert into public.eavesly_full_qa_rule_proposals(call_id,module_name,feedback_revision,criterion_key,proposed_rule,why,
    source_prompt_sha256,source_current_criterion,proposed_by)
  values(p_call_id,'full_qa',p_feedback_revision,p_criterion_key,private.trim_internal_review_text(p_proposed_rule),
    private.trim_internal_review_text(p_why),v_catalog.prompt_sha256,v_criterion,v_actor) returning id,proposed_at into v_id,v_at;
  return jsonb_build_object('proposal_id',v_id,'proposed_at',v_at,'decision','pending');
end $$;

create or replace function public.decide_full_qa_rule_proposal(p_proposal_id bigint,p_expected_decision text,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor text:=private.internal_alert_actor_email(); v_row public.eavesly_full_qa_rule_proposals%rowtype;
begin
  if not exists(select 1 from public.manager_coaching_prompts p where lower(p.manager_email)=v_actor and p.is_god_mode) then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  if p_expected_decision<>'pending' or p_decision not in ('accepted_for_evaluation','rejected')
    or char_length(private.trim_internal_review_text(p_reason)) not between 12 and 4000 then raise exception using errcode='P0001',message='EAVESLY_INVALID_RULE_PROPOSAL_DECISION'; end if;
  select * into v_row from public.eavesly_full_qa_rule_proposals where id=p_proposal_id for update;
  if not found then raise exception using errcode='P0001',message='EAVESLY_RULE_PROPOSAL_NOT_FOUND'; end if;
  if v_row.decision<>'pending' then
    if v_row.decision=p_decision and v_row.decision_reason=private.trim_internal_review_text(p_reason) then
      return jsonb_build_object('proposal_id',v_row.id,'decision',v_row.decision,'decided_at',v_row.decided_at,'idempotent',true); end if;
    raise exception using errcode='P0001',message='EAVESLY_RULE_PROPOSAL_DECISION_CONFLICT'; end if;
  update public.eavesly_full_qa_rule_proposals set decision=p_decision,decided_by=v_actor,decided_at=now(),decision_reason=private.trim_internal_review_text(p_reason)
    where id=p_proposal_id returning * into v_row;
  return jsonb_build_object('proposal_id',v_row.id,'decision',v_row.decision,'decided_at',v_row.decided_at,'idempotent',false);
end $$;

create or replace function public.full_qa_finding_occurrences(p_agent_email text,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor text:=private.internal_alert_actor_email(); v_god boolean; v_rows jsonb;
begin
  select exists(select 1 from public.manager_coaching_prompts p where lower(p.manager_email)=v_actor and p.is_god_mode) into v_god;
  if not v_god and not exists(select 1 from public.agent_manager_mapping a where lower(a.agent_email)=lower(p_agent_email) and lower(a.manager_email)=v_actor)
    then raise exception using errcode='P0001',message='EAVESLY_FORBIDDEN'; end if;
  with current_reviews as (
    select r.*,m.agent_email,m.created_at as alert_created_at,c.started_at as call_started_at,d.decision
    from public.eavesly_full_qa_review_revisions r join public.eavesly_alert_feedback f using(call_id,module_name)
    join public.eavesly_module_results m on m.call_id=r.call_id and m.module_name=r.module_name and m.alert_sent=true
    left join public.eavesly_calls c on c.call_id=r.call_id
    left join public.eavesly_alert_review_decisions d on d.call_id=r.call_id and d.module_name=r.module_name and d.feedback_revision=r.feedback_revision
    where r.feedback_revision=f.review_revision and lower(m.agent_email)=lower(p_agent_email)
      and ((c.started_at between p_start and p_end) or (c.started_at is null and m.created_at between p_start and p_end))
  ), coaching_events as (
    -- One immutable proxy per coached call/category: later edits on that same call never move it.
    select lower(m.agent_email) agent_email,finding->>'category' category,r.call_id,min(r.saved_at) proxy_at
    from public.eavesly_full_qa_review_revisions r join public.eavesly_module_results m on m.call_id=r.call_id and m.module_name=r.module_name
    join public.eavesly_alert_review_decisions d on d.call_id=r.call_id and d.module_name=r.module_name and d.feedback_revision=r.feedback_revision and d.decision='approved'
    cross join lateral jsonb_array_elements(r.findings) finding where r.action_taken='coached'
    group by lower(m.agent_email),finding->>'category',r.call_id
  ), occurrences as (
    select jsonb_build_object('occurrence_kind','finding','call_id',r.call_id,'module_name','full_qa','feedback_revision',r.feedback_revision,
      'call_started_at',r.call_started_at,'window_basis',case when r.call_started_at is null then 'alert_created_at_fallback' else 'call_started_at' end,
      'status',coalesce(r.decision,'pending'),'finding_id',f->>'finding_id','category',f->>'category','related_criteria',f->'related_criteria',
      'summary',f->>'summary','evidence',f->>'evidence','action_taken',r.action_taken,'action_details',r.action_details,
      'review_saved_at',r.saved_at,'confirmed',coalesce(r.decision='approved',false),'coaching_review_proxy_saved_at',p.proxy_at,
      'coaching_timing',case when r.call_started_at is null then 'unknown' when p.proxy_at is null then 'no_prior_recorded_coaching'
        when r.call_started_at>p.proxy_at then 'after_recorded_coached_review' else 'before_or_same_as_recorded_coached_review' end) row_json,
      coalesce(r.call_started_at,r.alert_created_at) sort_at,0 sort_kind
    from current_reviews r cross join lateral jsonb_array_elements(r.findings)f
    left join lateral (
      select e.proxy_at from coaching_events e where e.agent_email=lower(r.agent_email) and e.category=f->>'category' and e.call_id<>r.call_id
      order by (r.call_started_at is not null and e.proxy_at<r.call_started_at) desc,
        case when r.call_started_at is not null and e.proxy_at<r.call_started_at then e.proxy_at end desc,
        case when r.call_started_at is null or e.proxy_at>=r.call_started_at then e.proxy_at end asc
      limit 1
    ) p on true
    union all
    select jsonb_build_object('occurrence_kind','needs_context','call_id',r.call_id,'module_name','full_qa','feedback_revision',r.feedback_revision,
      'call_started_at',r.call_started_at,'window_basis',case when r.call_started_at is null then 'alert_created_at_fallback' else 'call_started_at' end,
      'status',coalesce(r.decision,'pending'),'criterion_key',c->>'criterion_key','reason',c->>'reason','review_saved_at',r.saved_at,'confirmed',false,'coaching_timing','unknown'),
      coalesce(r.call_started_at,r.alert_created_at),1 from current_reviews r cross join lateral jsonb_array_elements(r.corrections)c where c->>'disposition'='needs_context'
    union all
    select jsonb_build_object('occurrence_kind','legacy_unmapped','call_id',f.call_id,'module_name','full_qa','feedback_revision',f.review_revision,
      'call_started_at',c.started_at,'window_basis',case when c.started_at is null then 'alert_created_at_fallback' else 'call_started_at' end,
      'status','legacy_unmapped','review_saved_at',f.reviewed_at,'confirmed',false,'coaching_timing','unknown'),coalesce(c.started_at,m.created_at),2
    from public.eavesly_alert_feedback f join public.eavesly_module_results m on m.call_id=f.call_id and m.module_name=f.module_name and m.alert_sent=true
    left join public.eavesly_calls c on c.call_id=f.call_id
    where f.module_name='full_qa' and lower(m.agent_email)=lower(p_agent_email)
      and not exists(select 1 from public.eavesly_full_qa_review_revisions r where r.call_id=f.call_id and r.module_name=f.module_name and r.feedback_revision=f.review_revision)
      and ((c.started_at between p_start and p_end) or (c.started_at is null and m.created_at between p_start and p_end))
  ) select coalesce(jsonb_agg(row_json order by sort_at desc,sort_kind),'[]'::jsonb) into v_rows from occurrences;
  return v_rows;
end $$;

revoke all on function public.submit_full_qa_review(text,integer,bigint,text,jsonb,jsonb,boolean,text,text,text,text),
  public.get_full_qa_review_context(text),public.propose_full_qa_rule(text,integer,text,text,text),
  public.decide_full_qa_rule_proposal(bigint,text,text,text),public.full_qa_finding_occurrences(text,timestamptz,timestamptz) from public,anon;
grant execute on function public.submit_full_qa_review(text,integer,bigint,text,jsonb,jsonb,boolean,text,text,text,text),
  public.get_full_qa_review_context(text),public.propose_full_qa_rule(text,integer,text,text,text),
  public.decide_full_qa_rule_proposal(bigint,text,text,text),public.full_qa_finding_occurrences(text,timestamptz,timestamptz) to authenticated;

comment on table public.eavesly_full_qa_rubric_catalog is 'Immutable exact prompt catalog; accepted proposals never mutate or publish it.';
comment on table public.eavesly_full_qa_review_revisions is 'Append-only reviewed-source snapshots and manager judgments for one feedback revision.';
comment on column public.eavesly_full_qa_review_revisions.saved_at is 'Immutable review saved date used only as an explicit coaching-date proxy.';
comment on table public.eavesly_full_qa_rule_proposals is 'Candidate rules; accepted_for_evaluation is not a production publication.';
