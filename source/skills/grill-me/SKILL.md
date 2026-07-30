---
name: grill-me
description: A relentless one-question-at-a-time interview that resolves material decisions before a Snow plan is approved.
disable-model-invocation: true
allowed-tools: filesystem-read, ace-search, codebase-search, ide-get_diagnostics, askuser-ask_question, plan-manage
---

# Grill Me

Pressure-test the user's idea, design, or plan until every material decision is resolved.

## Workflow

1. Inspect the codebase first. Resolve facts with read/search tools instead of asking the user to describe existing behavior.
2. Build a private decision tree covering scope, behavior, data shape, public APIs, compatibility, failure handling, testing, and hard-to-reverse architecture.
3. Ask exactly one decision question at a time with `askuser-ask_question` and `purpose: "clarification"`.
4. Put the recommended answer first. Explain the important trade-off concisely, then wait for the user's answer.
5. Follow dependent branches one by one. Do not repeat resolved questions or ask preferences that cannot change the plan.
6. Stop only when no unresolved decision can materially change the implementation plan.

Do not implement during the interview. A clarification answer is never approval to execute code.

## Plan Mode Integration

When Plan Mode is active:

- Record confirmed choices in the draft plan under `### Resolved Decisions`, including the choice, reason, and material alternatives rejected.
- Use `plan-manage` to create or update the plan; never write `.snow/plan/**` through filesystem tools.
- After the decision tree is resolved, present a concise decision summary and the final plan.
- Ask for whole-plan execution approval separately with `askuser-ask_question` and `purpose: "plan_approval"`.

When Plan Mode is not active, finish with a shared-understanding summary and wait for the user's next instruction.
