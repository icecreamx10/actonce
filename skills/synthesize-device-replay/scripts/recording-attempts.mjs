export function indexRecordingAttempts(events) {
  const starts = new Map([[0, ["recording-start"]]]);

  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1];
    const reasons = [];
    if (isAttemptStart(event)) reasons.push("midscene-aiAct-start");
    const currentAttemptId = explicitAttemptId(event);
    const previousAttemptId = explicitAttemptId(previous);
    if (currentAttemptId && previousAttemptId && currentAttemptId !== previousAttemptId) {
      reasons.push("explicit-attempt-id-change");
    }
    if (Number.isInteger(event.sequence) && Number.isInteger(previous.sequence) && event.sequence < previous.sequence) {
      reasons.push("sequence-reset");
    }
    if (reasons.length) starts.set(index, [...(starts.get(index) ?? []), ...reasons]);
  }

  const boundaries = [...starts.keys()].sort((left, right) => left - right);
  return boundaries.map((fromAppendIndex, index) => {
    const toAppendIndex = (boundaries[index + 1] ?? events.length) - 1;
    const attemptEvents = events.slice(fromAppendIndex, toAppendIndex + 1);
    const explicitIds = unique(attemptEvents.map(explicitAttemptId).filter(Boolean));
    const executionIds = unique(attemptEvents.map((event) => event.executionId).filter(nonEmpty));
    const terminalPhases = attemptEvents
      .filter((event) => event.kind === "midscene.progress" && event.progress?.scope === "aiAct")
      .map((event) => event.progress?.phase)
      .filter((phase) => ["complete", "failed", "error"].includes(phase));
    const sequenceValues = attemptEvents.map((event) => event.sequence).filter(Number.isInteger);
    const duplicates = duplicateValues(sequenceValues);
    const key = `attempt-${index + 1}`;

    return {
      key,
      ordinal: index + 1,
      boundaryReasons: starts.get(fromAppendIndex) ?? [],
      appendIndexRange: { from: fromAppendIndex, to: toAppendIndex },
      wallTimeRange: {
        from: attemptEvents[0]?.wallTime ?? null,
        to: attemptEvents.at(-1)?.wallTime ?? null,
      },
      sequenceRange: sequenceValues.length
        ? { from: Math.min(...sequenceValues), to: Math.max(...sequenceValues) }
        : null,
      sequenceUnique: duplicates.length === 0,
      duplicateSequences: duplicates,
      eventCount: attemptEvents.length,
      completedActionCount: attemptEvents.filter((event) => event.kind === "logical.action.completed").length,
      executionIds,
      explicitAttemptIds: explicitIds,
      terminalPhase: terminalPhases.at(-1) ?? null,
      status: terminalPhases.at(-1) === "complete"
        ? "complete"
        : ["failed", "error"].includes(terminalPhases.at(-1))
          ? "failed"
          : index < boundaries.length - 1
            ? "superseded-incomplete"
            : "unterminated",
      events: attemptEvents,
    };
  });
}

export function attemptSummary(attempt) {
  const { events: _events, ...summary } = attempt;
  return summary;
}

export function selectAttempt(attempts, requestedKey) {
  if (requestedKey) {
    const matches = attempts.filter((attempt) => attempt.key === requestedKey
      || String(attempt.ordinal) === requestedKey
      || attempt.explicitAttemptIds.includes(requestedKey));
    if (matches.length > 1) {
      throw new Error(`Attempt selector ${JSON.stringify(requestedKey)} matches multiple attempts; use an attempt-N key`);
    }
    const selected = matches[0];
    if (!selected) {
      throw new Error(
        `Unknown attempt ${JSON.stringify(requestedKey)}. Available attempts: ${attempts.map((attempt) => attempt.key).join(", ")}`,
      );
    }
    return selected;
  }
  if (attempts.length !== 1) {
    throw new Error(
      `Recording contains ${attempts.length} attempts. Sequence selection is ambiguous; pass --attempt <key>. `
      + `Available attempts: ${attempts.map((attempt) => attempt.key).join(", ")}`,
    );
  }
  return attempts[0];
}

function isAttemptStart(event) {
  return event.kind === "midscene.progress"
    && event.progress?.scope === "aiAct"
    && event.progress?.phase === "start";
}

function explicitAttemptId(event) {
  const value = event.attemptId ?? event.correlation?.attemptId ?? event.metadata?.attemptId;
  return nonEmpty(value) ? value : null;
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function unique(values) {
  return [...new Set(values)];
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
