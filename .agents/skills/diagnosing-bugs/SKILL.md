---
name: diagnosing-bugs
description: Diagnose hard, ambiguous, intermittent bugs and performance regressions. Use when the user explicitly asks to diagnose or debug a non-trivial failure, or when the cause is uncertain. Do not use for an obvious local compile, lint, or test failure.
---

# Diagnosing bugs

Build the strongest practical feedback loop, gather evidence, and separate diagnosis from authorization to fix.

## 1. Establish the symptom and scope

1. Restate the observable failure, expected behavior, and affected environment.
2. Inspect the smallest relevant code and configuration surface needed to choose a reproduction strategy.
3. Read `CONTEXT.md` or an ADR only when it is relevant to that surface.
4. Distinguish a diagnosis-only request from a request that also authorizes implementation.

Do not change production behavior when the user asked only for diagnosis.

## 2. Build the best feasible feedback loop

Prefer a fast signal that exercises the reported behavior and can distinguish the bug from nearby failures:

1. focused failing test;
2. minimal CLI or function harness with a representative fixture;
3. focused Extension Host or Playwright scenario;
4. repeated or stressed execution for intermittent failures;
5. profiler or timing harness for performance regressions;
6. the bundled `scripts/hitl-loop.template.sh` when a human action cannot be automated.

Run the signal before relying on it. Tighten it when practical by reducing setup, isolating state, pinning time or randomness, and asserting the exact symptom.

A deterministic automated repro is preferred, not an absolute prerequisite. If one cannot be built safely or within the available environment:

- record what was attempted and what evidence is still missing;
- continue with read-only inspection, logs, traces, or targeted instrumentation when those can distinguish causes;
- state the resulting confidence and residual uncertainty;
- ask the user only for access or artifacts that are genuinely required.

## 3. Form and test hypotheses

Rank a small set of plausible, falsifiable hypotheses from the evidence. For each hypothesis, identify the observation that would support or reject it.

Test the highest-value distinction first. Change one variable at a time. Prefer debugger inspection or narrowly targeted logs over broad logging. Tag temporary instrumentation with a unique prefix so it can be removed reliably.

For performance regressions, establish a baseline before changing behavior and compare the same workload after each change.

## 4. Minimize and identify the cause

When a repro exists, remove inputs, callers, configuration, and steps one at a time while preserving the failure. Stop when further reduction would change the failure mode.

Report the causal chain, not only the line that throws:

- triggering condition;
- incorrect state transition or assumption;
- user-visible consequence;
- why existing checks or tests did not catch it.

## 5. Fix only when authorized

If the request includes a fix:

1. add a regression test at the lowest boundary that reproduces the real bug pattern, when such a seam exists;
2. observe it fail before the fix when practical;
3. implement the smallest causal fix;
4. run the focused signal again;
5. use `graphics-workbench-verify` to select the remaining checks.

If no correct test seam exists, document that limitation instead of adding a shallow test that gives false confidence.

## 6. Clean up and report

- Remove temporary instrumentation and throwaway artifacts.
- Report commands run, evidence obtained, root cause, confidence, and unresolved uncertainty.
- For a fix, report the regression coverage and any unverified environment-specific behavior.
- Recommend architectural follow-up only when it concretely reduces recurrence or makes the behavior testable.
